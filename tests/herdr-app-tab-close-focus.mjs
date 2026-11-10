#!/usr/bin/env node
// Run: node tests/herdr-app-tab-close-focus.mjs
import assert from 'node:assert/strict';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { createTabCloseFocus } = await import(new URL('mods/navigator-status/tab-close-focus.js', root));

const calls = [];
const focus = createTabCloseFocus({ run: (name, args) => calls.push([name, args]) });
const tab = (id, active = false, settled = false) => ({ id, active, settled });
const see = (...spaces) => {
  calls.length = 0;
  // The first space listed is the shown one.
  focus.onSpacesChanged(spaces.map(([id, tabs], i) => ({ id, tabs, active: i === 0 })));
  return calls.map(([, args]) => args.id);
};

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

console.log('PASS: closing the shown tab shows its left neighbor, like the TUI');
