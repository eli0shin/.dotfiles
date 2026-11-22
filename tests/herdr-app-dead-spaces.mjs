#!/usr/bin/env node
// Run: node tests/herdr-app-dead-spaces.mjs
import assert from 'node:assert/strict';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { createDeadSpaces } = await import(new URL('mods/navigator-status/dead-spaces.js', root));

const shell = { key: 'fish', shell: true, agent: false };
const pi = { key: 'pi', shell: false, agent: true };

// The folders that exist; everything else is gone.
let present = new Set();
let model = { spaces: [], terminals: [] };
let execs = 0;
let execFails = false;
let duringExec = null;
const closed = [];
const toasts = [];

const deadSpaces = createDeadSpaces({
  spaces: () => model.spaces,
  terminals: () => model.terminals,
  exec: async (cmd, args) => {
    execs++;
    if (execFails) throw new Error('unreachable');
    duringExec?.();
    assert.equal(cmd, 'sh');
    const paths = args.slice(3);
    return { code: 0, stdout: paths.map((p) => (present.has(p) ? '1' : '0')).join('\n') + '\n', stderr: '' };
  },
  run: (name, args) => {
    assert.equal(name, 'space.close');
    assert.equal(args.confirmed, true);
    closed.push(args.id);
    model.spaces = model.spaces.filter((s) => s.id !== args.id);
  },
  notify: (n) => toasts.push(n),
  home: () => '/home/me',
});

const space = (id, folder, extra = {}) => ({ id, name: id, folder, machine: null, active: false, tabs: [], ...extra });
const term = (address, spaceId, cwd, extra = {}) => ({
  address, state: 'live', status: null, report: null, program: shell, cwd,
  foreground: { cwd }, labels: { 'herdr.space': spaceId }, ...extra,
});
const reset = (spaces, terminals, folders = []) => {
  model = { spaces, terminals };
  present = new Set(folders);
  closed.length = 0;
  toasts.length = 0;
  execs = 0;
  execFails = false;
  duringExec = null;
};
// Two sweeps: a space must be found dead on both.
const sweepTwice = async () => { await deadSpaces.sweep(); await deadSpaces.sweep(); };

// A worktree space with an idle shell whose folder was deleted closes on the second sweep.
reset([space('gone', '/w/gone')], [term('t1', 'gone', '/w/gone')]);
await deadSpaces.sweep();
assert.deepEqual(closed, [], 'Not on the first sweep');
await deadSpaces.sweep();
assert.deepEqual(closed, ['gone']);
assert.equal(toasts.length, 1);
assert.match(toasts[0].title, /gone/);

// A folder that comes back between sweeps keeps its space.
reset([space('blip', '/w/blip')], [term('t1', 'blip', '/w/blip')]);
await deadSpaces.sweep();
present.add('/w/blip');
await deadSpaces.sweep();
present.delete('/w/blip');
await deadSpaces.sweep();
assert.deepEqual(closed, [], 'The confirmation starts over after the folder came back');

// An existing folder keeps the space.
reset([space('here', '/w/here')], [term('t1', 'here', '/w/here')], ['/w/here']);
await sweepTwice();
assert.deepEqual(closed, []);

// A shell that cd'ed somewhere that exists keeps the space.
reset([space('moved', '/w/moved')], [term('t1', 'moved', '/w/other')], ['/w/other']);
await sweepTwice();
assert.deepEqual(closed, []);

// Any terminal in a living folder keeps the space, even if others are in dead ones.
reset([space('split', '/w/split')], [term('t1', 'split', '/w/split'), term('t2', 'split', '/w/alive')], ['/w/alive']);
await sweepTwice();
assert.deepEqual(closed, []);

// An agent, a reported status or a program in front keeps the space, and nothing is checked.
for (const extra of [{ program: pi }, { status: 'idle' }, { report: { status: 'idle' } }, { program: { key: 'nvim', shell: false } }]) {
  reset([space('busy', '/w/busy')], [term('t1', 'busy', '/w/busy', extra)]);
  await sweepTwice();
  assert.deepEqual(closed, [], `Kept with ${JSON.stringify(extra)}`);
  assert.equal(execs, 0);
}

// A dead-folder shell beside an agent's terminal keeps the space.
reset([space('mixed', '/w/mixed')], [term('t1', 'mixed', '/w/mixed'), term('t2', 'mixed', '/w/mixed', { program: pi })]);
await sweepTwice();
assert.deepEqual(closed, []);

// The shown space, another machine's space and a space with no live terminals are left alone.
reset(
  [space('shown', '/w/shown', { active: true }), space('vps/sp', '/w/remote', { machine: 'vps' }), space('empty', '/w/empty')],
  [term('t1', 'shown', '/w/shown'), term('vps/t2', 'vps/sp', '/w/remote'), term('t3', 'empty', '/w/empty', { state: 'finished' })],
);
await sweepTwice();
assert.deepEqual(closed, []);
assert.equal(execs, 0);

// An unknown terminal folder keeps the space.
reset([space('unknown', '/w/unknown')], [term('t1', 'unknown', null, { foreground: null })]);
await sweepTwice();
assert.deepEqual(closed, []);

// A space with no folder of its own starts at home, which still exists: kept.
reset([space('home', '')], [term('t1', 'home', '/w/home-gone')], ['/home/me']);
await sweepTwice();
assert.deepEqual(closed, []);

// A failed folder check closes nothing.
reset([space('gone', '/w/gone')], [term('t1', 'gone', '/w/gone')]);
execFails = true;
await sweepTwice();
assert.deepEqual(closed, []);

// A program starting between sweeps keeps the space.
reset([space('late', '/w/late')], [term('t1', 'late', '/w/late')]);
await deadSpaces.sweep();
model.terminals = [term('t1', 'late', '/w/late', { program: pi })];
await deadSpaces.sweep();
assert.deepEqual(closed, []);

// A program starting, or the space being shown, while the check runs keeps the space.
for (const change of [
  () => { model.terminals = [term('t1', 'race', '/w/race', { program: pi })]; },
  () => { model.spaces = [space('race', '/w/race', { active: true })]; },
]) {
  reset([space('race', '/w/race')], [term('t1', 'race', '/w/race')]);
  await deadSpaces.sweep();
  duringExec = change;
  await deadSpaces.sweep();
  assert.deepEqual(closed, []);
}

// Only the dead space among several closes.
reset(
  [space('a', '/w/a'), space('b', '/w/b')],
  [term('t1', 'a', '/w/a'), term('t2', 'b', '/w/b')],
  ['/w/b'],
);
await sweepTwice();
assert.deepEqual(closed, ['a']);

console.log('herdr-app dead spaces: ok');
