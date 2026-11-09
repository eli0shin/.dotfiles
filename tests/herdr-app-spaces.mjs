#!/usr/bin/env node
// Exercise the personal Spaces row renderer without changing live spaces.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const source = readFileSync(new URL('mods/eli-spaces/main.js', root), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default class Spaces', 'class Spaces')
  .replace(/^export /gm, '');
function element() {
  const node = { children: [], styles: {} };
  const chain = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'child') return child => { node.children.push(child); return chain; };
      if (key === 'when') return (condition, apply) => condition ? apply(chain) : chain;
      return (...args) => { node.styles[key] = args; return chain; };
    },
  });
  return chain;
}
const Spaces = vm.runInNewContext(`${source}\nSpaces;`, {
  View: class {}, div: element, h_flex: element, v_flex: element, svg: element,
  spaces: () => [], shared: () => null,
  run: () => { throw new Error('Rendering must not rename or mutate spaces'); },
});
function row({ name = 'proxmox-config@devbox-workmac-ssh-port', named = true,
  tree = '└─', branch = 'devbox-workmac-ssh-port', ahead = 0, behind = 0 } = {}) {
  const view = new Spaces();
  view.pressed = null;
  return view.row({
    w: { id: 'worktree', name, named, folder: '/code/proxmox-config-devbox-workmac-ssh-port' },
    i: 1, tree,
    g: { name: 'proxmox-config', branch, linked: true, ahead, behind },
  }, {});
}
function texts(node) {
  return typeof node === 'string' ? [node] : node.children.flatMap(texts);
}
function label(node, text) {
  if (typeof node === 'string') return null;
  return node.children.includes(text) ? node : node.children.map(child => label(child, text)).find(Boolean);
}

test('the personal layout uses the persistent personal Spaces mod', () => {
  const layout = JSON.parse(readFileSync(new URL('layouts/eli.json', root)));
  function find(node) {
    return node.id === 'spaces' ? node : node.children?.map(find).find(Boolean);
  }
  assert.equal(find(layout).content.mod, 'eli-spaces');
  const manifest = JSON.parse(readFileSync(new URL('mods/eli-spaces/mod.json', root)));
  assert.equal(manifest.cloned_from.name, 'spaces');
  assert.equal(manifest.place, 'none');
});

test('nested repos worktrees show one name without the repository prefix', () => {
  assert.deepEqual(texts(row()), ['devbox-workmac-ssh-port']);
});
test('nested labels use the available width, with no fixed name cap', () => {
  const name = label(row(), 'devbox-workmac-ssh-port');
  assert.ok(name);
  assert.ok('flex_1' in name.styles);
  assert.equal(name.styles.min_w[0], 0);
  assert.ok(!('max_w' in name.styles));
});
test('automatic names use the branch instead of the repo-prefixed folder', () => {
  assert.deepEqual(texts(row({ name: 'proxmox-config-devbox-workmac-ssh-port', named: false })), ['devbox-workmac-ssh-port']);
});
test('custom names stay visible without a second branch suffix', () => {
  assert.deepEqual(texts(row({ name: 'Networking fix' })), ['Networking fix']);
});
test('repos names retain their spelling across slashes and branch switches', () => {
  assert.deepEqual(texts(row({ name: 'proxmox-config@fix-network', branch: 'fix/network' })), ['fix-network']);
  assert.deepEqual(texts(row({ branch: 'another-branch' })), ['devbox-workmac-ssh-port']);
});
test('detached worktrees keep a useful name', () => {
  assert.deepEqual(texts(row({ name: 'detached-checkout', named: false, branch: '(detached)' })), ['detached-checkout']);
});
test('ahead/behind counters survive without repeating the branch', () => {
  assert.deepEqual(texts(row({ ahead: 2, behind: 1 })), ['devbox-workmac-ssh-port', '↑2', '↓1']);
});
test('standalone rows retain their name and git context', () => {
  const visible = texts(row({ name: 'Networking fix', tree: null }));
  assert.ok(visible.includes('Networking fix'));
  assert.ok(visible.includes('proxmox-config · devbox-workmac-ssh-port'));
});
