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
const { planOpen, placeIn, remoteLookup, planRemote, fileUriPath, NEOVIM_EXTENSIONS } = await import(new URL('mods/nvim-links/open.js', root));
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = { terminal: 't7', machine: null, cwd: '/w/repo', pane: 'p1', tab: 'tb1', space: 'sp1' };
const click = (raw, path, extra = {}) => ({ link: { kind: 'file', raw, path }, source: { ...source, ...extra } });
const argv = (...args) => planOpen(click(...args))?.argv ?? null;

// Neovim opens the file types the Neovim app is the editor for, and nothing else.
{
  const script = readFileSync(new URL('../home/.local/bin/install-neovim-app', import.meta.url), 'utf8');
  const block = script.slice(script.indexOf('<key>CFBundleTypeExtensions</key>'));
  const listed = [...block.slice(0, block.indexOf('</array>')).matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  assert.ok(listed.length > 40);
  assert.deepEqual([...NEOVIM_EXTENSIONS].sort(), [...listed].sort(), 'nvim-links opens what install-neovim-app makes Neovim the editor for');
}

// Absolute and relative paths both open the path Herdr resolved, in a split beside the clicked pane.
assert.deepEqual(planOpen(click('/tmp/notes.txt', '/tmp/notes.txt')), { path: '/tmp/notes.txt', pane: 'p1', argv: ['nvim', '--', '/tmp/notes.txt'] });
assert.deepEqual(argv('src/a.ts', '/w/repo/src/a.ts'), ['nvim', '--', '/w/repo/src/a.ts']);

// A place in the file puts the cursor there.
assert.deepEqual(argv('src/a.ts:42', '/w/repo/src/a.ts'), ['nvim', '+42', '--', '/w/repo/src/a.ts']);
assert.deepEqual(argv('src/a.ts:42:7', '/w/repo/src/a.ts'), ['nvim', '+call cursor(42, 7)', '--', '/w/repo/src/a.ts']);
assert.deepEqual(argv('src/a.ts:42.', '/w/repo/src/a.ts'), ['nvim', '+42', '--', '/w/repo/src/a.ts'], 'a sentence\'s period is not part of it');
assert.equal(placeIn('notes:42', '/w/repo/notes:42'), null, 'a file named with a colon and digits keeps its name');
assert.equal(placeIn('file:///w/repo/a.ts', '/w/repo/a.ts'), null);
assert.deepEqual(argv('-weird.md', '/w/repo/-weird.md'), ['nvim', '--', '/w/repo/-weird.md'], 'a path starting with - is still a file');

// Herdr's own opener keeps: missing files, other machines, URLs, and files Neovim can't show.
assert.equal(planOpen(click('src/gone.ts', null)), null);
assert.equal(planOpen(click('/srv/app.ts', null, { machine: 'vps' })), null, 'a remote click is looked up there instead');
assert.equal(planOpen({ link: { kind: 'url', raw: 'https://x.dev', url: 'https://x.dev' }, source }), null);
for (const file of ['shot.png', 'a.JPG', 'doc.pdf', 'clip.mov', 'song.mp3', 'out.tar.gz', 'Makefile', '.gitignore', 'notes.docx']) {
  assert.equal(planOpen(click(file, `/w/repo/${file}`)), null, `${file} goes to the system opener`);
}
for (const file of ['a.ts', 'README.MD', 'x.lua', 'deploy.env']) {
  assert.ok(planOpen(click(file, `/w/repo/${file}`)), `${file} opens in Neovim`);
}

// On another machine the mod looks the spellings up there, with that pane's folder.
{
  const remote = (raw, cwd = '/home/eli/repo') => click(raw, null, { machine: 'vps', cwd, pane: 'vps/p3' });
  const lookup = remoteLookup(remote('src/a.ts:42:7.'));
  assert.equal(lookup.machine, 'vps');
  assert.deepEqual(lookup.args.slice(2), ['sh', '/home/eli/repo', 'src/a.ts:42:7.', 'src/a.ts']);
  assert.deepEqual(lookup.candidates, [null, { line: 42, col: 7 }]);
  assert.deepEqual(planRemote(remote('src/a.ts:42:7.'), lookup, '1\t/home/eli/repo/src/a.ts\n'),
    { path: '/home/eli/repo/src/a.ts', pane: 'vps/p3', argv: ['nvim', '+call cursor(42, 7)', '--', '/home/eli/repo/src/a.ts'] });
  assert.equal(planRemote(remote('a.ts'), remoteLookup(remote('a.ts')), ''), null, 'nothing found there: nothing opens');
  assert.equal(planRemote(remote('shot.png'), remoteLookup(remote('shot.png')), '0\t/home/eli/repo/shot.png\n'), null);
  assert.deepEqual(remoteLookup(remote('file:///srv/my%20app.ts')).args.slice(4), ['/srv/my app.ts'], 'a file URI there names a file there');
  assert.equal(remoteLookup(remote('file://otherhost/srv/a.ts')), null);
  assert.equal(fileUriPath('file:///etc/hosts#L10'), '/etc/hosts', 'a fragment is not part of the path');
  assert.equal(fileUriPath('file:///etc/hosts?x=1'), '/etc/hosts');
  assert.equal(fileUriPath('file:/etc/hosts'), '/etc/hosts', 'file: without // names a path too');
  assert.equal(fileUriPath('FILE://LOCALHOST/etc/hosts'), '/etc/hosts');
  assert.equal(fileUriPath('file:///bad%zz'), null);
  assert.equal(remoteLookup(click('a.ts', '/w/repo/a.ts')), null, 'local clicks use the path Herdr resolved');

  // The lookup script itself, run in sh against a scratch tree, as the machine would.
  const dir = mkdtempSync(join(tmpdir(), 'nvim-links-'));
  try {
    mkdirSync(join(dir, 'repo/src'), { recursive: true });
    mkdirSync(join(dir, 'repo/folder'));
    writeFileSync(join(dir, 'repo/src/a.ts'), '');
    writeFileSync(join(dir, 'repo/notes:42'), '');
    writeFileSync(join(dir, 'home.txt'), '');
    const find = (raw, cwd = join(dir, 'repo')) => {
      const { args } = remoteLookup(remote(raw, cwd));
      try {
        return execFileSync('sh', args, { env: { ...process.env, HOME: dir }, encoding: 'utf8' });
      } catch {
        return null;
      }
    };
    assert.equal(find('src/a.ts:42'), `1\t${dir}/repo/src/a.ts\n`);
    assert.equal(find(`${dir}/repo/src/a.ts`), `0\t${dir}/repo/src/a.ts\n`, 'an absolute path is used as it is');
    assert.equal(find('notes:42'), `0\t${dir}/repo/notes:42\n`, 'a file named with :42 wins over line 42 of notes');
    assert.equal(find('~/home.txt'), `0\t${dir}/home.txt\n`);
    assert.equal(find('$PWD/src/a.ts'), `0\t${dir}/repo/src/a.ts\n`);
    process.env.NVIM_LINKS_TEST_DIR = join(dir, 'repo');
    assert.equal(find('$NVIM_LINKS_TEST_DIR/src/a.ts'), `0\t${dir}/repo/src/a.ts\n`, 'a variable there is read from its environment');
    assert.equal(find('$NVIM_LINKS_UNSET/src/a.ts'), null);
    assert.equal(find('$(touch x)/a'), null, 'clicked text is never run');
    assert.equal(find('$HOME/home.txt'), `0\t${dir}/home.txt\n`);
    assert.equal(find('folder'), null, 'a folder is not a file');
    assert.equal(find('src/gone.ts'), null);
    assert.equal(find('src/a.ts', ''), null, 'without the pane\'s folder a relative path finds nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A click in a layout terminal block has no pane: the split goes beside the focused one.
assert.equal(planOpen(click('a.ts', '/w/repo/a.ts', { pane: null })).pane, null);

console.log('herdr-app nvim links: all checks passed');
