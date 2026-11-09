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
let execResult = { code: 0 };
const calls = [];
const warnings = [];
const nav = createNavigator({
  focused: () => focus,
  terminals: () => records,
  hc: async (args) => {
    calls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  },
  exec: async (command, args, options) => {
    calls.push(['exec', command, args, options]);
    if (execResult instanceof Error) throw execResult;
    return { stdout: '', stderr: '', ...execResult };
  },
  run: (name, args) => calls.push([name, args]),
  notify: (message) => warnings.push(message),
});

// Without Neovim in front, the chords move between Herdr panes, nothing else.
for (const direction of ['left', 'down', 'up', 'right']) {
  calls.length = 0;
  await nav.navigate(direction);
  assert.deepEqual(calls, [['pane.go', { direction }]]);
}

// Neovim in front (even under a wrapper such as `fish -c`) gets the key over
// its own server with `nvim` from PATH, never `hc keys`: the core holds those
// after a person types.
records[0].labels['dotfiles.navigator.editor'] = '/tmp/nvim.1.0';
for (const [direction, key] of Object.entries({ left: 'h', down: 'j', up: 'k', right: 'l' })) {
  calls.length = 0;
  await nav.navigate(direction);
  assert.deepEqual(calls, [['exec', 'nvim', ['--server', '/tmp/nvim.1.0', '--remote-send', `<C-${key}>`], { on: null, timeout: 2000 }]]);
}

// A Neovim that died without releasing the terminal: forget it and move.
execResult = { code: 2, stderr: 'E247: Failed to connect' };
calls.length = 0;
await nav.navigate('left');
assert.deepEqual(calls.slice(1), [['label', 't1', 'dotfiles.navigator.editor='], ['pane.go', { direction: 'left' }]]);
assert.equal(warnings.length, 0);

// No `nvim` to run is a setup problem: say so, and don't move.
execResult = new Error('cannot run nvim: No such file or directory');
calls.length = 0;
await nav.navigate('left');
assert.deepEqual(calls.map((c) => c[0]), ['exec']);
assert.equal(warnings.length, 1);
execResult = { code: 0 };
delete records[0].labels['dotfiles.navigator.editor'];

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

// A remote Neovim's server is reached on its own machine.
records.push({ address: 'work/t7', labels: { 'dotfiles.navigator.editor': '/run/nvim.7.0' } });
focus = { terminal: 'work/t7', pane: 'work/p7', tab: 'work/tab7' };
calls.length = 0;
await nav.navigate('up');
assert.deepEqual(calls, [['exec', 'nvim', ['--server', '/run/nvim.7.0', '--remote-send', '<C-k>'], { on: 'work', timeout: 2000 }]]);

// A dead server found after focus moved must not move the new pane.
let finishSend;
const delayed = createNavigator({
  focused: () => focus,
  terminals: () => records,
  hc: async () => ({ code: 0 }),
  exec: () => new Promise((resolve) => { finishSend = resolve; }),
  run: (name) => calls.push(name),
  notify: () => {},
});
calls.length = 0;
const pending = delayed.navigate('right');
focus = { terminal: 't3', pane: 'p3', tab: 'tab3' };
finishSend({ code: 2, stdout: '', stderr: '' });
await pending;
assert.deepEqual(calls, []);
console.log('PASS: Neovim key routing over RPC, edge handoffs, remote machines, dead servers, stale focus');

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
