#!/usr/bin/env node
// Run: node tests/herdr-app-navigation.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const keys = JSON.parse(readFileSync(new URL('keys.json', root)));
for (const [key, direction] of Object.entries({ h: 'left', j: 'down', k: 'up', l: 'right' })) {
  const binding = keys['layout:eli']?.[`ctrl-${key}`] ?? keys.global[`ctrl-${key}`];
  assert.equal(binding, `navigator-status.${direction}`, `Ctrl+${key} must use the Neovim-aware bridge`);
}

const { createNavigator } = await import(new URL('mods/navigator-status/navigation.js', root));
let focus = { terminal: 't1', pane: 'p1', tab: 'tab1' };
let records = [{ address: 't1', labels: {} }];
let foreground = { name: 'nvim', argv: ['nvim'] };
let code = 0;
let execCode = 0;
const calls = [];
const warnings = [];
const nav = createNavigator({
  focused: () => focus,
  terminals: () => records,
  hc: async (args) => {
    calls.push(args);
    return { code, stdout: JSON.stringify({ foreground }), stderr: 'core unavailable' };
  },
  exec: async (command, args, options) => {
    calls.push(['exec', command, args, options]);
    if (execCode === null) throw new Error('cannot run');
    return { code: execCode, stdout: '', stderr: '' };
  },
  run: (name, args) => calls.push([name, args]),
  notify: (message) => warnings.push(message),
});

for (const [direction, key] of Object.entries({ left: 'h', down: 'j', up: 'k', right: 'l' })) {
  calls.length = 0;
  await nav.navigate(direction);
  assert.deepEqual(calls, [['get', 't1', '--json'], ['keys', 't1', `ctrl+${key}`]]);
}
for (const name of ['fzf', '/usr/local/bin/nvim', 'nvim-wrapped', 'vim']) {
  calls.length = 0;
  foreground = { name };
  await nav.navigate('down');
  assert.deepEqual(calls.at(-1), ['keys', 't1', 'ctrl+j']);
}
foreground = { name: 'fish', argv: ['fish'] };
calls.length = 0;
await nav.navigate('left');
assert.deepEqual(calls.at(-1), ['pane.go', { direction: 'left' }]);

// Neovim in front (even under a wrapper such as `fish -c`) gets the key over
// its own server, never `hc keys`: the core holds those after a person types.
const nvimLabel = JSON.stringify({ nvim: '/opt/homebrew/bin/nvim', server: '/tmp/nvim.1.0' });
records[0].labels['dotfiles.navigator.editor'] = nvimLabel;
foreground = { name: 'fish', argv: ['fish', '-c', 'pr'] };
for (const [direction, key] of Object.entries({ left: 'h', down: 'j', up: 'k', right: 'l' })) {
  calls.length = 0;
  await nav.navigate(direction);
  assert.deepEqual(calls, [['exec', '/opt/homebrew/bin/nvim', ['--server', '/tmp/nvim.1.0', '--remote-send', `<C-${key}>`], { on: null, timeout: 2000 }]]);
}
// A dead server falls back to what is in front now.
for (const failure of [2, null]) {
  execCode = failure;
  calls.length = 0;
  await nav.navigate('left');
  assert.deepEqual(calls.slice(1), [['get', 't1', '--json'], ['pane.go', { direction: 'left' }]]);
}
execCode = 0;
// Only Neovim is ever run from a label.
for (const bad of ['{"nvim":"/bin/sh","server":"/tmp/x"}', '{"nvim":"/opt/homebrew/bin/nvim"}', '20523', 'not json']) {
  records[0].labels['dotfiles.navigator.editor'] = bad;
  calls.length = 0;
  await nav.navigate('left');
  assert.deepEqual(calls, [['get', 't1', '--json'], ['pane.go', { direction: 'left' }]], bad);
}
delete records[0].labels['dotfiles.navigator.editor'];
foreground = { name: 'fish', argv: ['fish'] };

// Consume an edge handoff once, only while its source still has focus.
records[0].labels['dotfiles.navigator'] = '123:1:right';
calls.length = 0;
nav.onTerminalsChanged();
nav.onTerminalsChanged();
assert.deepEqual(calls, [['pane.go', { direction: 'right' }]]);
focus = { terminal: 't2', pane: 'p2', tab: 'tab1' };
records[0].labels['dotfiles.navigator'] = '123:2:left';
nav.onTerminalsChanged();
focus = { terminal: 't1', pane: 'p1', tab: 'tab1' };
nav.onTerminalsChanged();
assert.equal(calls.length, 1, 'stale requests must not move a newly focused pane');

// A newly observed terminal's historical label must not be replayed.
records.push({ address: 't2', labels: { 'dotfiles.navigator': '321:1:down' } });
focus = { terminal: 't2', pane: 'p2', tab: 'tab1' };
nav.onTerminalsChanged();
assert.equal(calls.length, 1);
records[1].labels['dotfiles.navigator'] = '321:2:down';
nav.onTerminalsChanged();
assert.deepEqual(calls.at(-1), ['pane.go', { direction: 'down' }]);

// Remote terminal addresses are kept intact; no local pane CLI is needed.
calls.length = 0;
focus = { terminal: 'work/t7', pane: 'work/p7', tab: 'work/tab7' };
foreground = { name: 'nvim' };
await nav.navigate('up');
assert.deepEqual(calls, [['get', 'work/t7', '--json'], ['keys', 'work/t7', 'ctrl+k']]);
// A remote Neovim's server is reached on its own machine.
records.push({ address: 'work/t7', labels: { 'dotfiles.navigator.editor': JSON.stringify({ nvim: 'nvim', server: '/run/nvim.7.0' }) } });
calls.length = 0;
await nav.navigate('up');
assert.deepEqual(calls, [['exec', 'nvim', ['--server', '/run/nvim.7.0', '--remote-send', '<C-k>'], { on: 'work', timeout: 2000 }]]);
records.pop();

// Do not route a delayed process lookup to whichever pane became focused.
let finishLookup;
const delayed = createNavigator({
  focused: () => focus,
  terminals: () => records,
  hc: () => new Promise((resolve) => { finishLookup = resolve; }),
  exec: async () => assert.fail('no editor label'),
  run: (name) => calls.push(name),
  notify: () => {},
});
calls.length = 0;
const pending = delayed.navigate('right');
focus = { terminal: 't3', pane: 'p3', tab: 'tab3' };
finishLookup({ code: 0, stdout: JSON.stringify({ foreground: { name: 'fish' } }) });
await pending;
assert.deepEqual(calls, []);

// Errors must surface, not silently turn an editor key into a pane move.
code = 1;
calls.length = 0;
await nav.navigate('left');
assert.equal(warnings.length, 1);
assert.equal(calls.length, 1);
console.log('PASS: Neovim-aware key routing, edge handoffs, remote addresses, stale focus, errors');

// Legacy Ctrl+G, S: the spaces picker; Ctrl+G, Shift+1–9: numbered agents.
assert.equal(keys.global['ctrl-g s'], 'mod.open:space-picker');
for (const [i, shifted] of [...'!@#$%^&*('].entries()) {
  assert.equal(keys['layout:eli'][`ctrl-g shift-${i + 1}`], `navigator-status.agent-${i + 1}`);
  assert.equal(keys['layout:eli'][`ctrl-g ${shifted}`], `navigator-status.agent-${i + 1}`);
}

const { focusNumberedAgent, orderInputs } = await import(new URL('mods/navigator-status/agent-order.js', root));
const agent = (address, status, seq, extra = {}) => ({ address, status, seq, pinned: false, ...extra });
let agentList = [agent('a', 'idle', 9), agent('b', 'working', 1), agent('c', 'blocked', 2), agent('d', 'working', 5)];
let allTerminals = [];
let sort;
let published;
const focusCalls = [];
const focusAgent = (n) => {
  focusCalls.length = 0;
  const handled = focusNumberedAgent(`agent-${n}`, {
    agents: () => agentList,
    terminals: () => allTerminals,
    shared: (key) => (key === 'agents.sort' ? sort : key === 'dotfiles.agents.order' ? published : undefined),
    run: (name, args) => focusCalls.push([name, args]),
  });
  return handled ? focusCalls.at(-1)?.[1]?.terminal ?? null : 'unhandled';
};
// Priority (default): most urgent first, ties by most recent change.
assert.deepEqual([1, 2, 3, 4].map(focusAgent), ['c', 'd', 'b', 'a']);
assert.equal(focusAgent(5), null, 'a missing agent number does nothing');
assert.equal(focusAgent(0), 'unhandled');
// A parent takes its most urgent live sub-agent's rank.
allTerminals = [{ address: 'k', parent: 'a', state: 'live', status: 'error' }];
assert.equal(focusAgent(1), 'a');
allTerminals = [{ address: 'k', parent: 'a', state: 'exited', status: 'error' }];
assert.equal(focusAgent(1), 'c');
// Pinned agents come first, in either sort; grouped keeps model order.
agentList[1].pinned = true;
assert.equal(focusAgent(1), 'b');
sort = 'grouped';
assert.deepEqual([1, 2, 3, 4].map(focusAgent), ['b', 'a', 'c', 'd']);
// The sidebar's published order wins while it describes the current agents
// (e.g. it keeps a viewed done agent in Done), and is ignored once stale.
published = { inputs: orderInputs(agentList, sort), addresses: ['d', 'gone', 'c', 'b', 'a'] };
assert.deepEqual([1, 2, 3, 4].map(focusAgent), ['d', 'c', 'b', 'a']);
agentList[3].status = 'idle';
assert.deepEqual([1, 2, 3, 4].map(focusAgent), ['b', 'a', 'c', 'd']);
// Both copies of orderInputs must stay identical.
const clone = readFileSync(new URL('mods/eli-agents/main.js', root), 'utf8');
const source = readFileSync(new URL('mods/navigator-status/agent-order.js', root), 'utf8');
const definition = (text) => text.match(/const orderInputs = .*$/m)?.[0];
assert.ok(definition(clone) && definition(clone) === definition(source), 'orderInputs drifted between eli-agents and agent-order.js');
// dot stow sets tracked preferences in a running app through this command.
const { applySharedPreferences } = await import(new URL('mods/navigator-status/preferences.js', root));
const set = [];
const notes = [];
const prefs = { setShared: (key, value) => set.push([key, value]), notify: (m) => notes.push(m) };
assert.equal(applySharedPreferences('left', prefs), false);
assert.equal(applySharedPreferences('set-shared:{"workspace.panels":[],"a":1}', prefs), true);
assert.deepEqual(set, [['workspace.panels', []], ['a', 1]]);
for (const bad of ['set-shared:{', 'set-shared:[]', 'set-shared:null']) {
  assert.equal(applySharedPreferences(bad, prefs), true);
}
assert.equal(set.length, 2, 'invalid payloads set nothing');
assert.equal(notes.length, 3);
assert.deepEqual(notes[0], { title: 'navigator-status', body: 'set-shared needs one JSON object', level: 'error' });
console.log('PASS: spaces picker key, numbered agent focus order, live preferences');
