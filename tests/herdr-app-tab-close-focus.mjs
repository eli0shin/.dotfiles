#!/usr/bin/env node
// Run: node tests/herdr-app-tab-close-focus.mjs
import assert from 'node:assert/strict';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { createTabCloseFocus } = await import(new URL('mods/navigator-status/tab-close-focus.js', root));

const calls = [];
const focus = createTabCloseFocus({ run: (name, args) => calls.push([name, args]) });
const tab = (id, active = false, settled = false) => ({ id, active, settled });
// Agents in the Agents list order: [address, tab, space].
let agents = [];
const see = (...spaces) => {
  calls.length = 0;
  // The first space listed is the shown one.
  const list = agents.map(([address, tab, space = 's']) => ({ address, tab, space }));
  // Agents are listed by the app in model order; the Agents list may sort them otherwise.
  focus.onSpacesChanged(spaces.map(([id, tabs], i) => ({ id, tabs, active: i === 0 })), [...list].reverse(), () => list);
  return calls.map(([name, args]) => name === 'agent.focus' ? `agent ${args.terminal}` : args.id);
};
// Each close drops its tab's agents before the new snapshot.
const close = (tab, ...spaces) => { agents = agents.filter(([, t]) => t !== tab); return see(...spaces); };

// A, B, C showing B: closing B shows A, not the app's C.
see(['s', [tab('A'), tab('B', true), tab('C')]]);
assert.deepEqual(see(['s', [tab('A'), tab('C', true)]]), ['A']);
// The app reports A shown after the select: nothing more to do.
assert.deepEqual(see(['s', [tab('A', true), tab('C')]]), []);

// Closing the first tab keeps the new first tab, like the TUI.
assert.deepEqual(see(['s', [tab('C', true)]]), []);

// Closing a tab that isn't shown leaves the shown one alone.
see(['s', [tab('A'), tab('B'), tab('C', true)]]);
assert.deepEqual(see(['s', [tab('B'), tab('C', true)]]), []);

// Settled tabs are skipped, as tab.next/prev skip them; all settled: no change.
see(['s', [tab('A'), tab('B', false, true), tab('C', true), tab('D')]]);
assert.deepEqual(see(['s', [tab('A'), tab('B', false, true), tab('D', true)]]), ['A']);
see(['s', [tab('A', false, true), tab('B', true), tab('C')]]);
assert.deepEqual(see(['s', [tab('A', false, true), tab('C', true)]]), []);

// Already on the left neighbor (e.g. the app chose it): no select.
see(['s', [tab('A'), tab('B', true), tab('C')]]);
assert.deepEqual(see(['s', [tab('A', true), tab('C')]]), []);

// A snapshot with no shown tab keeps the last view until one is shown.
see(['s', [tab('A'), tab('B', true), tab('C')]]);
assert.deepEqual(see(['s', [tab('A'), tab('C')]]), []);
assert.deepEqual(see(['s', [tab('A'), tab('C', true)]]), ['A']);

// A close in a background space keeps the app's choice: tab.select would show that space.
see(['s', [tab('A'), tab('B', true)]], ['work/t', [tab('work/X'), tab('work/Y', true), tab('work/Z')]]);
assert.deepEqual(see(['s', [tab('A'), tab('B', true)]], ['work/t', [tab('work/X'), tab('work/Z', true)]]), []);
// Remote spaces work once shown; a gone space is forgotten, a new one only recorded.
see(['work/t', [tab('work/X'), tab('work/Y', true), tab('work/Z')]]);
assert.deepEqual(see(['work/t', [tab('work/X'), tab('work/Z', true)]]), ['work/X']);
see(['s', [tab('A'), tab('B', true)]]);
assert.deepEqual(see(['work/t', [tab('work/X'), tab('work/Z', true)]]), []);

// Agents' tabs are hidden from the bar, so closing another tab never shows one.
agents = [['a', 'A'], ['c', 'C']];
see(['s', [tab('X'), tab('A'), tab('B', true), tab('C')]]);
assert.deepEqual(see(['s', [tab('X'), tab('A'), tab('C', true)]]), ['X'], 'Skips the agent tab to the left');
// No shown tab to the left: the nearest shown one to the right, not the app's agent tab.
see(['s', [tab('A'), tab('B', true), tab('C'), tab('D')]]);
assert.deepEqual(see(['s', [tab('A'), tab('C', true), tab('D')]]), ['D']);
// Only agents' tabs left: nothing better to show.
see(['s', [tab('A'), tab('B', true), tab('C')]]);
assert.deepEqual(see(['s', [tab('A'), tab('C', true)]]), []);

// Closing an agent's tab goes to the next agent in the Agents list, not a tab.
agents = [['c', 'C'], ['a', 'A'], ['d', 'D']];
see(['s', [tab('X'), tab('A', true), tab('C'), tab('D')]]);
assert.deepEqual(close('A', ['s', [tab('X'), tab('C', true), tab('D')]]), ['agent d'], 'The next agent in list order, not the next tab');
// The last agent in the list wraps to the first.
agents = [['c', 'C'], ['a', 'A'], ['d', 'D']];
see(['s', [tab('X'), tab('A'), tab('C'), tab('D', true)]]);
assert.deepEqual(close('D', ['s', [tab('X'), tab('A'), tab('C', true)]]), ['agent c']);
// Even an agent in another space: the list spans spaces.
agents = [['a', 'A'], ['work/w1', 'work/W', 'work/t']];
see(['s', [tab('X'), tab('A', true)]], ['work/t', [tab('work/W', true)]]);
assert.deepEqual(close('A', ['s', [tab('X', true)]], ['work/t', [tab('work/W', true)]]), ['agent work/w1']);
// A split tab's agents all go with it: the next agent after the last of them.
agents = [['a1', 'A'], ['c', 'C'], ['a2', 'A'], ['d', 'D']];
see(['s', [tab('A', true), tab('C'), tab('D')]]);
assert.deepEqual(close('A', ['s', [tab('C', true), tab('D')]]), ['agent d']);
// No other agent: the nearest shown tab, as for any tab.
agents = [['a', 'A']];
see(['s', [tab('X'), tab('A', true), tab('Y')]]);
assert.deepEqual(close('A', ['s', [tab('X'), tab('Y', true)]]), ['X']);
// A snapshot with no shown tab between keeps what the closed tab held.
agents = [['a', 'A'], ['c', 'C']];
see(['s', [tab('X'), tab('A', true), tab('C')]]);
assert.deepEqual(close('A', ['s', [tab('X'), tab('C')]]), []);
assert.deepEqual(see(['s', [tab('X'), tab('C', true)]]), ['agent c']);
agents = [];

console.log('PASS: closing the shown tab shows its left neighbor, like the TUI, skipping agents\' tabs; an agent\'s tab goes to the next agent');
