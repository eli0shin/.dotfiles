#!/usr/bin/env node
// Run: node tests/herdr-app-jump-list.mjs
// The tab jump list in mods/navigator-status/jump-list.js (Ctrl+G O / Ctrl+G I).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const keys = JSON.parse(readFileSync(new URL('keys.json', root)));
assert.equal(keys['layout:eli']['ctrl-g o'], 'navigator-status.jump-list-back');
assert.equal(keys['layout:eli']['ctrl-g i'], 'navigator-status.jump-list-forward');
const { createJumpList, MAX_ENTRIES } = await import(new URL('mods/navigator-status/jump-list.js', root));

// A window: tabs come on screen at a time, and the jump list's jumps show their tab.
function window() {
  const jumps = createJumpList();
  let now = 0;
  const open = new Set();
  const live = (tab) => open.has(tab);
  const visit = (tab, stay = 2000) => {
    open.add(tab);
    jumps.shown(tab, now);
    now += stay;
  };
  const move = (dir, stay = 2000) => {
    const tab = dir === 'back' ? jumps.back(live) : jumps.forward(live);
    if (tab) jumps.shown(tab, now);
    now += stay;
    return tab;
  };
  return { jumps, visit, move, open, on: () => jumps.state().current };
}

// Back and forward walk the tabs you looked at.
{
  const w = window();
  for (const tab of ['A', 'B', 'C', 'D']) w.visit(tab);
  assert.equal(w.move('back'), 'C');
  assert.equal(w.move('back'), 'B');
  assert.equal(w.move('forward'), 'C');
  assert.equal(w.move('forward'), 'D', 'forward comes back to the tab you jumped back from');
  assert.equal(w.move('forward'), null);
  assert.equal(w.on(), 'D');
}

// Neovim's default list: going somewhere new after jumping back moves the tab
// you left to the end and drops nothing (A B C D, back twice to B, then E).
{
  const w = window();
  for (const tab of ['A', 'B', 'C', 'D']) w.visit(tab);
  w.move('back');
  w.move('back');
  w.visit('E');
  assert.deepEqual(w.jumps.state().list, ['A', 'C', 'D', 'B']);
  assert.deepEqual(['back', 'back', 'back', 'back', 'back'].map((d) => w.move(d)), ['B', 'D', 'C', 'A', null]);
  assert.deepEqual(['forward', 'forward', 'forward', 'forward'].map((d) => w.move(d)), ['C', 'D', 'B', 'E']);
}

// A tab counts only after a full second on screen: flipping past tabs adds nothing.
{
  const w = window();
  w.visit('A');
  w.visit('B', 300);
  w.visit('C', 999);
  w.visit('D', 1000);
  w.visit('E', 100);
  assert.deepEqual(w.jumps.state().list, ['A', 'D']);
  assert.equal(w.move('back'), 'D');
  assert.equal(w.move('back'), 'A');
  assert.equal(w.move('forward'), 'D');
  assert.equal(w.move('forward'), 'E', 'the tab you jumped back from comes back even if you just got there');
}

// The jump list's own jumps aren't visits: flashing back past tabs keeps them where they are.
{
  const w = window();
  for (const tab of ['A', 'B', 'C']) w.visit(tab);
  w.move('back', 0);
  w.move('back', 0);
  assert.equal(w.on(), 'A');
  assert.deepEqual(w.jumps.state().list, ['A', 'B', 'C']);
}

// A tab is in the list once, where you last left it.
{
  const w = window();
  for (const tab of ['A', 'B', 'A', 'C', 'B', 'D']) w.visit(tab);
  assert.deepEqual(w.jumps.state().list, ['A', 'C', 'B']);
}

// Closed tabs are skipped.
{
  const w = window();
  for (const tab of ['A', 'B', 'C', 'D']) w.visit(tab);
  w.open.delete('C');
  w.open.delete('A');
  assert.equal(w.move('back'), 'B');
  assert.equal(w.move('back'), null);
  assert.equal(w.on(), 'B');
  assert.equal(w.move('forward'), 'D');
}

// Moving inside a tab (the same tab shown again) changes nothing.
{
  const w = window();
  w.visit('A');
  w.visit('A');
  w.visit('B');
  assert.deepEqual(w.jumps.state().list, ['A']);
}

// With nothing to go back to, Ctrl+G O does nothing, and doesn't add the tab you're on.
{
  const w = window();
  w.visit('A', 100);
  assert.equal(w.move('back', 200), null);
  assert.equal(w.on(), 'A');
  assert.deepEqual(w.jumps.state().list, []);
  w.visit('B');
  assert.equal(w.move('back'), null, 'A was only on screen 300 ms');
}

// A full list doesn't drop the one open tab left to go back to.
{
  const w = window();
  for (let i = 0; i <= MAX_ENTRIES; i++) w.visit(`T${i}`);
  for (let i = 1; i < MAX_ENTRIES; i++) w.open.delete(`T${i}`);
  assert.equal(w.move('back'), 'T0');
  assert.equal(w.move('forward'), `T${MAX_ENTRIES}`);
}

// The list keeps the newest entries.
{
  const w = window();
  for (let i = 0; i <= MAX_ENTRIES + 10; i++) w.visit(`T${i}`);
  const { list } = w.jumps.state();
  assert.equal(list.length, MAX_ENTRIES);
  assert.equal(list.at(-1), `T${MAX_ENTRIES + 9}`);
}

console.log('herdr-app jump list: all checks passed');
