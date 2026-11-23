#!/usr/bin/env node
// The Agents list's machine filter: the popup's rows and changes
// (mods/agent-machines/filter.js), the order that skips hidden machines
// (mods/navigator-status/agent-order.js), and the copies that must agree.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { machineRows, toggleMachine, onlyMachine } = await import(new URL('mods/agent-machines/filter.js', root));
const { agentOrder, orderInputs } = await import(new URL('mods/navigator-status/agent-order.js', root));
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('rows: this computer, connected machines, then machines known only from agents or the filter', () => {
  const known = [{ name: null, layout: 'ready' }, { name: 'work-mac', layout: 'ready' }, { name: 'devbox', layout: 'unavailable' }];
  const rows = machineRows(known, ['', 'work-mac', 'work-mac', 'vps'], ['old-box']);
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.count, r.hidden, r.offline]), [
    ['', 'This computer', 1, false, false],
    ['work-mac', 'work-mac', 2, false, false],
    ['devbox', 'devbox', 0, false, true],
    ['vps', 'vps', 1, false, true],
    ['old-box', 'old-box', 0, true, true],
  ]);
});

test('space toggles one machine; enter keeps only one', () => {
  assert.deepEqual(toggleMachine([], 'work-mac'), ['work-mac']);
  assert.deepEqual(toggleMachine(['work-mac', ''], 'work-mac'), ['']);
  const rows = [{ key: null }, { key: '' }, { key: 'work-mac' }, { key: 'devbox' }];
  assert.deepEqual(onlyMachine(rows, ''), ['work-mac', 'devbox']);
  assert.deepEqual(onlyMachine(rows, 'work-mac'), ['', 'devbox']);
});

test('the order leaves out agents on hidden machines, published or not', () => {
  const list = [
    { address: 'work-mac/t1', status: 'working', pinned: false, seq: 3 },
    { address: 't2', status: 'idle', pinned: false, seq: 2 },
    { address: 't3', status: 'idle', pinned: false, seq: 1 },
  ];
  const terminals = () => [];
  const addresses = (agents) => agents.map((a) => a.address);
  // Not published: mirrors the sort without them.
  assert.deepEqual(addresses(agentOrder(list, { terminals, sort: 'priority', published: null, hidden: ['work-mac'] })), ['t2', 't3']);
  assert.deepEqual(addresses(agentOrder(list, { terminals, sort: 'priority', published: null, hidden: [''] })), ['work-mac/t1']);
  // Published by the sidebar over the visible agents: used as is.
  const shown = list.slice(1);
  const published = { inputs: orderInputs(shown, 'priority'), addresses: ['t3', 't2'] };
  assert.deepEqual(addresses(agentOrder(list, { terminals, sort: 'priority', published, hidden: ['work-mac'] })), ['t3', 't2']);
  // Published before work-mac was hidden: stale, so the sort is mirrored instead.
  const before = { inputs: orderInputs(list, 'priority'), addresses: ['t3', 'work-mac/t1', 't2'] };
  assert.deepEqual(addresses(agentOrder(list, { terminals, sort: 'priority', published: before, hidden: ['work-mac'] })), ['t2', 't3']);
});

test('the copies of the filter key and machineOf agree, and Ctrl+G, / opens the popup', () => {
  const agree = (files, pattern) => {
    const [first, ...rest] = files.map(read).map((s) => s.match(pattern)?.[0]);
    assert.ok(first, `${pattern} missing`);
    for (const other of rest) assert.equal(other, first);
  };
  const filtering = ['mods/eli-agents/main.js', 'mods/agent-machines/main.js', 'mods/navigator-status/agent-order.js', 'mods/pr-finder/main.js'];
  agree([...filtering, 'mods/eli-chrome/main.js'], /const HIDDEN_MACHINES_KEY = .*$/m);
  agree(filtering, /const machineOf = .*$/m);
  assert.equal(JSON.parse(read('keys.json')).global['ctrl-g /'], 'mod.open:agent-machines');
});
