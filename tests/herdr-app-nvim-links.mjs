#!/usr/bin/env node
// Run: node tests/herdr-app-nvim-links.mjs
// Checks what mods/nvim-links opens for a Cmd-click, given the link Herdr 0.1.17 passes it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const layout = JSON.parse(readFileSync(new URL('layouts/eli.json', root)));
assert.deepEqual(layout.link_handlers, ['nvim-links'], 'the eli layout sends file clicks to nvim-links');
const mod = JSON.parse(readFileSync(new URL('mods/nvim-links/mod.json', root)));
assert.deepEqual(mod.link_handlers, [{ kind: 'file', pattern: '.' }]);
const { planOpen, placeIn } = await import(new URL('mods/nvim-links/open.js', root));

const source = { terminal: 't7', machine: null, cwd: '/w/repo', pane: 'p1', tab: 'tb1', space: 'sp1' };
const click = (raw, path, extra = {}) => ({ link: { kind: 'file', raw, path }, source: { ...source, ...extra } });
const argv = (...args) => planOpen(click(...args))?.argv ?? null;

// Absolute and relative paths both open the path Herdr resolved, in a split beside the clicked pane.
assert.deepEqual(planOpen(click('/etc/hosts', '/etc/hosts')), { path: '/etc/hosts', pane: 'p1', argv: ['nvim', '--', '/etc/hosts'] });
assert.deepEqual(argv('src/a.ts', '/w/repo/src/a.ts'), ['nvim', '--', '/w/repo/src/a.ts']);

// A place in the file puts the cursor there.
assert.deepEqual(argv('src/a.ts:42', '/w/repo/src/a.ts'), ['nvim', '+42', '--', '/w/repo/src/a.ts']);
assert.deepEqual(argv('src/a.ts:42:7', '/w/repo/src/a.ts'), ['nvim', '+call cursor(42, 7)', '--', '/w/repo/src/a.ts']);
assert.deepEqual(argv('src/a.ts:42.', '/w/repo/src/a.ts'), ['nvim', '+42', '--', '/w/repo/src/a.ts'], 'a sentence\'s period is not part of it');
assert.equal(placeIn('notes:42', '/w/repo/notes:42'), null, 'a file named with a colon and digits opens as named');
assert.equal(placeIn('file:///w/repo/a.ts', '/w/repo/a.ts'), null);
assert.deepEqual(argv('-weird.md', '/w/repo/-weird.md'), ['nvim', '--', '/w/repo/-weird.md'], 'a path starting with - is still a file');

// Herdr's own opener keeps: missing files, other machines, URLs, and files Neovim can't show.
assert.equal(planOpen(click('src/gone.ts', null)), null);
assert.equal(planOpen(click('/srv/app.ts', null, { machine: 'vps' })), null);
assert.equal(planOpen({ link: { kind: 'url', raw: 'https://x.dev', url: 'https://x.dev' }, source }), null);
for (const file of ['shot.png', 'a.JPG', 'doc.pdf', 'clip.mov', 'out.tar.gz']) {
  assert.equal(planOpen(click(file, `/w/repo/${file}`)), null, `${file} goes to the system opener`);
}

// A click in a layout terminal block has no pane: the split goes beside the focused one.
assert.equal(planOpen(click('a.ts', '/w/repo/a.ts', { pane: null })).pane, null);

console.log('herdr-app nvim links: all checks passed');
