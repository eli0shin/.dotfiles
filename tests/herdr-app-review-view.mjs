#!/usr/bin/env node
// The review TUI as a view of Herdr (mods/navigator-status/review-view.js):
// Cmd+R finds this machine's review, starts one, or goes back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { createReviewView, reviewTabIds, REVIEW_ARGV, REVIEW_LABEL } = await import(new URL('mods/navigator-status/review-view.js', root));
const { selectTab } = await import(new URL('mods/navigator-status/tab-order.js', root));

function setup({ focused, terminals, spaces = [{ id: 's1', active: true, machine: null }, { id: 'work-mac/s2', machine: 'work-mac' }] }) {
  const calls = [];
  const state = { focused, terminals };
  const view = createReviewView({ spaces: () => spaces, focused: () => state.focused, terminals: () => state.terminals, run: (...c) => calls.push(c) });
  return { view, calls, state };
}
const review = (address, extra = {}) => ({ address, state: 'live', labels: { [REVIEW_LABEL]: '1' }, ...extra });

test('only its own command is handled', () => {
  const { view, calls } = setup({ focused: null, terminals: [] });
  assert.equal(view.handle('tab-next'), false);
  assert.deepEqual(calls, []);
});

test('jumps to this machine\'s review, then back to where you were', () => {
  const { view, calls, state } = setup({
    focused: { space: 's1', terminal: 't1' },
    terminals: [{ address: 't1', state: 'live' }, review('work-mac/t5'), review('t7')],
  });
  view.handle('review');
  assert.deepEqual(calls.at(-1), ['pane.focus', { terminal: 't7' }]);
  state.focused = { space: 's1', terminal: 't7' };
  view.handle('review');
  assert.deepEqual(calls.at(-1), ['pane.focus', { terminal: 't1' }]);
});

test('review-show shows the review but never goes back from it', () => {
  const { view, calls, state } = setup({
    focused: { space: 's1', terminal: 't1' },
    terminals: [{ address: 't1', state: 'live' }, review('t7')],
  });
  assert.equal(view.handle('review-show'), true);
  assert.deepEqual(calls, [['pane.focus', { terminal: 't7' }]]);
  state.focused = { space: 's1', terminal: 't7' };
  view.handle('review-show');
  assert.equal(calls.length, 1);
  view.handle('review');
  assert.deepEqual(calls.at(-1), ['pane.focus', { terminal: 't1' }]);
});

test('a remote space uses its machine\'s review', () => {
  const { view, calls } = setup({ focused: { space: 'work-mac/s2', terminal: 'work-mac/t2' }, terminals: [review('t7'), review('work-mac/t5')] });
  view.handle('review');
  assert.deepEqual(calls, [['pane.focus', { terminal: 'work-mac/t5' }]]);
});

test('without one, it starts a labelled review in the current space; an ended one does not count', () => {
  const { view, calls } = setup({ focused: { space: 's1', terminal: 't1' }, terminals: [review('t7', { state: 'finished' })] });
  view.handle('review');
  assert.deepEqual(calls, [['tab.new', { space: 's1', name: 'review', argv: REVIEW_ARGV }]]);
  assert.match(REVIEW_ARGV[2], /hc label "\$HC_TERMINAL_ID" dotfiles\.review=1/);
  assert.match(REVIEW_ARGV[2], /review; hc kill "\$HC_TERMINAL_ID"$/);
});

test('its tab is left out of the tab keys', () => {
  const tabs = [{ id: 'a', active: true }, { id: 'r' }, { id: 'b' }];
  const hidden = () => reviewTabIds([{ tab: 'r', terminal: 't7' }, { tab: 'b', terminal: 't8' }], [review('t7'), { address: 't8', state: 'live' }]);
  const calls = [];
  selectTab('tab-next', { spaces: () => [{ id: 's', active: true, tabs }], agents: () => [], run: (...c) => calls.push(c), order: () => [], hidden });
  selectTab('tab-2', { spaces: () => [{ id: 's', active: true, tabs }], agents: () => [], run: (...c) => calls.push(c), order: () => [], hidden });
  assert.deepEqual(calls, [['tab.select', { id: 'b' }], ['tab.select', { id: 'b' }]]);
});

test('Cmd+R runs it, and the bar uses the same label', () => {
  assert.equal(JSON.parse(readFileSync(new URL('keys.json', root), 'utf8')).global['cmd-r'], 'navigator-status.review');
  for (const mod of ['eli-tabs', 'space-picker']) {
    assert.ok(readFileSync(new URL(`mods/${mod}/main.js`, root), 'utf8').includes(`const REVIEW_LABEL = "${REVIEW_LABEL}";`), mod);
  }
});
