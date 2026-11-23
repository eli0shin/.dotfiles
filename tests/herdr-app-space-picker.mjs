#!/usr/bin/env node
// The spaces picker's fuzzy ranking (mods/space-picker/match.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { displayPath, rankSpaces } = await import(new URL('mods/space-picker/match.js', root));
const home = '/Users/eli';
const space = (name, extra = {}) => ({ name, folder: '', branch: null, machine: null, ...extra });
const names = (spaces) => spaces.map((s) => s.name);

test('an empty query keeps the space order', () => {
  const spaces = [space('b'), space('a')];
  assert.equal(rankSpaces('  ', spaces, home), spaces);
});

test('the space named like the query beats longer names', () => {
  const spaces = [space('dotfiles-pi-models'), space('ffs-mono-repo'), space('dotfiles')];
  assert.deepEqual(names(rankSpaces('dotfiles', spaces, home)), ['dotfiles', 'dotfiles-pi-models']);
});

test('scattered letters match in order, and every term must match', () => {
  const spaces = [space('photo-frame'), space('ffs-mono-repo'), space('forgecad')];
  assert.deepEqual(names(rankSpaces('pf', spaces, home)), ['photo-frame']);
  assert.deepEqual(names(rankSpaces('frame photo', spaces, home)), ['photo-frame']);
  assert.deepEqual(names(rankSpaces('fmr', spaces, home)), ['ffs-mono-repo']);
  assert.deepEqual(names(rankSpaces('zzz', spaces, home)), []);
});

test('a word start beats a match mid-word', () => {
  const spaces = [space('reframe'), space('photo-frame')];
  assert.deepEqual(names(rankSpaces('frame', spaces, home)), ['photo-frame', 'reframe']);
});

test('the branch, folder and machine match too, below the name', () => {
  const spaces = [
    space('agents', { folder: '/Users/eli/.dotfiles' }),
    space('api', { branch: 'fix-login', machine: 'devbox' }),
    space('dotfiles'),
  ];
  assert.deepEqual(names(rankSpaces('dotfiles', spaces, home)), ['dotfiles', 'agents']);
  assert.deepEqual(names(rankSpaces('login', spaces, home)), ['api']);
  assert.deepEqual(names(rankSpaces('devbox', spaces, home)), ['api']);
  assert.deepEqual(names(rankSpaces('api login', spaces, home)), ['api']);
});

test('home shows as ~, and the query matches what is shown', () => {
  assert.equal(displayPath('/Users/eli/code', home), '~/code');
  assert.equal(displayPath('/Users/elise', home), '/Users/elise');
  const spaces = [space('x', { folder: '/Users/eli/code/x' }), space('y', { folder: '/opt/users/eli' })];
  assert.deepEqual(names(rankSpaces('~/c', spaces, home)), ['x']);
});
