#!/usr/bin/env node
// Space colors for the Agents list's space names (mods/eli-agents/colors.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { assignSpaceColors, spaceTextColor } = await import(new URL('mods/eli-agents/colors.js', root));

test('kept colors stay; new spaces get the least used; home and gone spaces get none', () => {
  const stored = { a: 'ansi6', gone: 'ansi3' };
  const { kept, changed } = assignSpaceColors([{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }, { id: 'h', name: '~' }], stored);
  assert.deepEqual(kept, { a: 'ansi6', b: 'ansi3' });
  assert.equal(changed, true);
  assert.equal(assignSpaceColors([{ id: 'a', name: 'x' }], { a: 'ansi6' }).changed, false);
});

test('as text, a color is lifted toward white; picked colors work too', () => {
  assert.equal(spaceTextColor('ansi4'), '#82a6ed');
  assert.equal(spaceTextColor('#000000'), '#414141');
  assert.equal(spaceTextColor(undefined), null);
  assert.equal(spaceTextColor('nope'), null);
});
