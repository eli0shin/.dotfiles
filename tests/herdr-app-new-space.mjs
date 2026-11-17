#!/usr/bin/env node
// The new-space picker's folder sources and ranking (mods/new-space/folders.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const { displayPath, gatherFolders, rankFolders, reposPaths, typedFolder } = await import(
  new URL('mods/new-space/folders.js', root)
);
const home = '/Users/eli';
const paths = (folders) => folders.map((folder) => folder.path);

test('the focused folder comes first, then zoxide, then repos zoxide has not seen', () => {
  const folders = gatherFolders({
    focused: '/Users/eli/code/repos/',
    zoxide: '/Users/eli/code/repos\n/Users/eli/.dotfiles\n\n',
    repos: ['/Users/eli/.dotfiles', '/Users/eli/code/ffs-mono-repo'],
  });
  assert.deepEqual(folders, [
    { path: '/Users/eli/code/repos', source: 'here' },
    { path: '/Users/eli/.dotfiles', source: 'zoxide' },
    { path: '/Users/eli/code/ffs-mono-repo', source: 'repo' },
  ]);
});

test('without sources yet, only the focused folder is offered', () => {
  assert.deepEqual(gatherFolders({ focused: null }), []);
  assert.deepEqual(gatherFolders({ focused: '/' }), [{ path: '/', source: 'here' }]);
});

test('repos config paths, ignoring anything unreadable', () => {
  assert.deepEqual(
    reposPaths(JSON.stringify({ repos: [{ name: 'a', path: '/x/a' }, { name: 'b' }] })),
    ['/x/a'],
  );
  assert.deepEqual(reposPaths(''), []);
  assert.deepEqual(reposPaths('{"repos": 3}'), []);
});

test('an empty query keeps the gathered order', () => {
  const folders = gatherFolders({ zoxide: '/b\n/a' });
  assert.deepEqual(rankFolders('  ', folders, home), folders);
});

test('the folder named like the query beats longer names and parent matches', () => {
  const folders = gatherFolders({
    zoxide: [
      '/Users/eli/code/repos-clean-index-keeps-focus',
      '/Users/eli/code/repos/src',
      '/Users/eli/code/repos',
      '/Users/eli/code/ffs-mono-repo',
    ].join('\n'),
  });
  assert.deepEqual(paths(rankFolders('repos', folders, home)), [
    '/Users/eli/code/repos',
    '/Users/eli/code/repos-clean-index-keeps-focus',
    '/Users/eli/code/repos/src',
  ]);
});

test('scattered letters match in order, and every term must match', () => {
  const folders = gatherFolders({
    zoxide: '/Users/eli/code/ffs-mono-repo\n/Users/eli/code/forgecad-work\n/Users/eli/.dotfiles',
  });
  assert.deepEqual(paths(rankFolders('fmr', folders, home)), ['/Users/eli/code/ffs-mono-repo']);
  assert.deepEqual(paths(rankFolders('code work', folders, home)), ['/Users/eli/code/forgecad-work']);
  assert.deepEqual(paths(rankFolders('zzz', folders, home)), []);
});

test('home shows as ~, and the query matches what is shown', () => {
  assert.equal(displayPath('/Users/eli/code', home), '~/code');
  assert.equal(displayPath('/Users/eli', home), '~');
  assert.equal(displayPath('/Users/elise', home), '/Users/elise');
  const folders = gatherFolders({ zoxide: '/Users/eli/code/x\n/opt/users/eli' });
  assert.deepEqual(paths(rankFolders('~/c', folders, home)), ['/Users/eli/code/x']);
});

test('a typed absolute or home path is a folder of its own', () => {
  assert.equal(typedFolder('/tmp/x/', home), '/tmp/x');
  assert.equal(typedFolder('/', home), '/');
  assert.equal(typedFolder('~', home), '/Users/eli');
  assert.equal(typedFolder(' ~/code/new ', home), '/Users/eli/code/new');
  assert.equal(typedFolder('repos', home), null);
  assert.equal(typedFolder('~/x', null), null);
});

test('the create-space keys open the picker', () => {
  const keys = JSON.parse(readFileSync(new URL('keys.json', root), 'utf8'));
  assert.equal(keys.global['cmd-n'], 'mod.open:new-space');
  assert.equal(keys.global['ctrl-g ctrl-s'], 'mod.open:new-space');
});
