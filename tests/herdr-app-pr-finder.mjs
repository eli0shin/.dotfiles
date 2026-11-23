#!/usr/bin/env node
// The PR finder (Ctrl+G, F; mods/pr-finder): which agent watches a PR.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { watchedPrs, rankAgents } = await import(new URL('mods/pr-finder/match.js', root));
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const row = (name, prs) => ({ name, prs });
const names = (rows) => rows.map((r) => r.name);

test('watched PRs come from refs, else the space repo stands in for #N', () => {
  assert.deepEqual(watchedPrs({ prs: ['#104', 'tool#7'], refs: ['eli0shin/repos#104', 'another/tool#7'] }, 'ignored'), [
    { label: '#104', repo: 'eli0shin/repos', number: '104' },
    { label: 'tool#7', repo: 'another/tool', number: '7' },
  ]);
  assert.deepEqual(watchedPrs({ prs: ['#104', 'tool#7'] }, 'repos'), [
    { label: '#104', repo: 'repos', number: '104' },
    { label: 'tool#7', repo: 'tool', number: '7' },
  ]);
  assert.deepEqual(watchedPrs({ sha: 'merge of #9' }, 'repos'), [{ label: 'merge of #9', repo: 'repos', number: '9' }]);
  assert.deepEqual(watchedPrs({ sha: 'SHA abc1234' }, 'repos'), []);
  assert.deepEqual(watchedPrs(null, 'repos'), []);
});

const ffs = (n) => ({ label: `#${n}`, repo: 'org/ffs-mono-repo', number: String(n) });
const rows = [
  row('orchestrator', [ffs(2031), ffs(2032), ffs(2040), { label: 'tool#7', repo: 'another/tool', number: '7' }]),
  row('worker', [ffs(2032)]),
  row('other', [{ label: '#20320', repo: 'org/other', number: '20320' }]),
];

test('an empty query keeps every row and its PRs', () => {
  const all = rankAgents('  ', rows);
  assert.deepEqual(names(all), ['orchestrator', 'worker', 'other']);
  assert.equal(all[0].matched.length, 4);
});

test('a PR number finds every agent watching it, exact before a longer number', () => {
  const found = rankAgents('2032', rows);
  assert.deepEqual(names(found), ['orchestrator', 'worker', 'other']);
  assert.deepEqual(found[0].matched.map((p) => p.label), ['#2032']);
  assert.deepEqual(names(rankAgents('#2032', rows)), ['orchestrator', 'worker', 'other']);
  assert.deepEqual(names(rankAgents('999', rows)), []);
});

test('repo words and repo#N narrow to one PR; terms must match the same PR', () => {
  assert.deepEqual(names(rankAgents('tool', rows)), ['orchestrator']);
  assert.deepEqual(names(rankAgents('tool#7', rows)), ['orchestrator']);
  assert.deepEqual(names(rankAgents('ffs 2040', rows)), ['orchestrator']);
  assert.deepEqual(names(rankAgents('tool 2032', rows)), []);
  assert.deepEqual(names(rankAgents('fmr 2032', rows)), ['orchestrator', 'worker']);
});

test('the copies match their originals, and Ctrl+G, F opens it', () => {
  for (const file of ['watch.js', 'colors.js', 'names.js']) {
    assert.equal(read(`mods/pr-finder/${file}`), read(`mods/eli-agents/${file}`), `${file} drifted from eli-agents`);
  }
  for (const pattern of [/const ORDER_KEY = .*$/m, /const LIVE_TITLE = .*$/m, /const CHIP_BG = .*$/m]) {
    assert.equal(read('mods/pr-finder/main.js').match(pattern)?.[0], read('mods/eli-agents/main.js').match(pattern)?.[0]);
  }
  assert.equal(JSON.parse(read('keys.json')).global['ctrl-g f'], 'mod.open:pr-finder');
});
