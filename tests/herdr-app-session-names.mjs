#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { piSessionName, tabNames } from '../home/.config/herdr-app/mods/eli-tabs/names.js';

// Each mod is sandboxed to its own directory; keep their local helpers identical.
assert.equal(
  readFileSync(new URL('../home/.config/herdr-app/mods/eli-tabs/names.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../home/.config/herdr-app/mods/eli-agents/names.js', import.meta.url), 'utf8'),
);

const pi = (tab, name, extra = {}) => ({ tab, title: `π - ${name} - .dotfiles`, cwd: '/Users/eli/.dotfiles', program: { key: 'pi', agent: true }, ...extra });
const tabs = [
  { id: 'a', name: '1', index: 1, named: false },
  { id: 'b', name: '2', index: 2, named: false },
  { id: 'c', name: 'My chosen tab', index: 3, named: true },
];
assert.equal(piSessionName(pi('a', 'Automate Pi Session Names')), 'Automate Pi Session Names');
assert.equal(piSessionName(pi('a', '', { title: 'π - .dotfiles' })), null);
assert.equal(piSessionName(pi('a', 'Ignore Me', { program: { key: 'shell' } })), null);
assert.equal(piSessionName(pi('a', 'Review - Session Names')), 'Review - Session Names');
assert.equal(piSessionName(pi('a', 'Name', { cwd: '/tmp/folder - spaced', title: 'π - Name - folder - spaced' })), 'Name');
assert.equal(piSessionName(pi('a', 'Name', { cwd: '/some/changed/folder' })), 'Name');
const panes = [pi('a', 'Automate Session Names'), pi('b', 'Fix Safari Login'), pi('c', 'Ignored Session Name')];
let names = tabNames(tabs, panes);
assert.equal(names.get('a'), 'Automate Session Names');
assert.equal(names.get('b'), 'Fix Safari Login');
assert.equal(names.get('c'), 'My chosen tab');
// New OSC titles are reflected immediately; explicit tab names are never changed.
panes[0] = pi('a', 'Fix Safari Login');
names = tabNames(tabs, panes);
assert.equal(names.get('a'), 'Fix Safari Login · 1');
assert.equal(names.get('b'), 'Fix Safari Login · 2');
assert.equal(tabNames(tabs, []).get('a'), '1');
assert.equal(tabNames(tabs, [pi('a', 'First'), pi('a', 'Second', { focused: true })]).get('a'), 'First');
const collision = [{ ...tabs[0], named: true, name: 'Fix Safari Login' }, tabs[1]];
names = tabNames(collision, panes);
assert.equal(names.get('a'), 'Fix Safari Login');
assert.equal(names.get('b'), 'Fix Safari Login · 2');
const suffixCollision = [...tabs, { id: 'd', name: 'Fix Safari Login · 1', named: true, index: 4 }];
names = tabNames(suffixCollision, panes);
assert.equal(names.get('a'), 'Fix Safari Login · 1.2');
assert.equal(names.get('d'), 'Fix Safari Login · 1');
assert.equal(new Set(names.values()).size, suffixCollision.length);
// Machine-qualified ids work without local socket calls or filesystem access.
assert.equal(tabNames([{ ...tabs[0], id: 'remote/a' }], [pi('remote/a', 'Remote Session')]).get('remote/a'), 'Remote Session');
console.log('Herdr Pi session naming checks passed');
