#!/usr/bin/env node
// Exercise the real tab renderer with GPUI element recording in place of native paint.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const overridesURL = new URL('programs.json', root);
const overrides = existsSync(overridesURL) ? JSON.parse(readFileSync(overridesURL)).programs : {};
const layout = JSON.parse(readFileSync(new URL('layouts/eli.json', root)));
function find(node, id) {
  if (node.id === id) return node;
  return node.children?.map(child => find(child, id)).find(Boolean);
}
const mod = find(layout, 'tabs').content.mod;
const naming = readFileSync(new URL(`mods/${mod}/names.js`, root), 'utf8').replace(/^export /gm, '');
const source = naming + '\n' + readFileSync(new URL(`mods/${mod}/main.js`, root), 'utf8');
let program;
function element(kind, path) {
  const node = { kind, path, nodes: [], color: null };
  const chain = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'child') return child => { node.nodes.push(child); return chain; };
      if (key === 'children') return children => { node.nodes.push(...children); return chain; };
      if (key === 'text_color') return color => { node.color = color; return chain; };
      if (key === 'when') return (condition, apply) => condition ? apply(chain) : chain;
      return () => chain;
    },
  });
  return chain;
}
const Tabs = vm.runInNewContext(source.replace(/^import .*;\n/gm, '').replace('export default class Tabs', 'class Tabs') + '\nTabs;', {
  View: class {},
  div: () => element('div'), h_flex: () => element('flex'),
  svg: path => element('svg', path), image: path => element('image', path),
  spaces: () => [{ id: 'space', active: true, tabs: [{ id: 'tab', name: '1', active: true }] }],
  panes: () => [{ tab: 'tab', program }],
  theme: () => ({ muted: '#aaaaaa', accent: '#61afef' }),
  layout: () => ({}), window: () => ({}), settings: () => ({ zoom: 1 }),
  shared: () => [], run: () => {}, openOverlay: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
});
function iconFor(defaults) {
  program = { ...defaults, ...overrides[defaults.key] };
  const view = new Tabs();
  view.init();
  function icon(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.path === program.icon) return node;
    return node.nodes.map(icon).find(Boolean);
  }
  return icon(view.render());
}

const pi = iconFor({ key: 'pi', icon: 'icons/pi.svg', tint: true, tile: '#1c1d21', color: '#ffffff' });
assert.equal(pi.kind, 'svg');
assert.equal(pi.color, '#a78bfa', 'Pi must be purple, not the muted gray text color');
const shell = iconFor({ key: 'shell', icon: 'icons/shell.svg', tint: true, color: '#4ec95f' });
assert.equal(shell.color, '#4ec95f', 'Shell must retain its program color');
const nvim = iconFor({ key: 'nvim', icon: 'icons/nvim.svg', tint: true, color: '#ffffff' });
assert.equal(nvim.kind, 'image', 'Neovim must use its full-color logo, not an SVG mask');
const nvimSVG = readFileSync(new URL(nvim.path, root), 'utf8');
assert.match(nvimSVG, /#16b0ed/i, 'Neovim logo must contain blue');
assert.match(nvimSVG, /#7db643/i, 'Neovim logo must contain green');
const picture = iconFor({ key: 'claude', icon: 'icons/claude.svg', tint: false });
assert.equal(picture.kind, 'image', 'Full-color program pictures must not be tinted');
const fallback = iconFor({ key: 'custom', icon: 'custom.svg', tint: true });
assert.equal(fallback.color, '#61afef', 'An uncolored glyph must fall back to the theme accent');
assert.equal(mod, 'eli-tabs', 'The personal layout must use the persistent personal mod');
console.log('Herdr tab icon rendering checks passed');
