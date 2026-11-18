#!/usr/bin/env node
// Ctrl+; then a label, focuses that Agents row (mods/agent-jump); eli-agents
// shows the same labels while the jump is open.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JUMP_KEY, jumpLabels, jumping } from '../home/.config/herdr-app/mods/agent-jump/jump.js';

const read = (path) => readFileSync(new URL(`../home/.config/herdr-app/${path}`, import.meta.url), 'utf8');
// Each mod is sandboxed to its own directory; keep their copies identical.
assert.equal(read('mods/agent-jump/jump.js'), read('mods/eli-agents/jump.js'));
assert.equal(JSON.parse(read('keys.json'))['layout:eli']['ctrl-;'], 'mod.open:agent-jump');
assert.equal(JUMP_KEY, 'dotfiles.agents.jumping');

// 1–9 and 0 as Ctrl+G Shift+1–0 reach them; letters follow, home row first.
assert.deepEqual(jumpLabels(3), ['1', '2', '3']);
assert.deepEqual(jumpLabels(13), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'a', 's', 'd']);
assert.deepEqual(jumpLabels(0), []);
const single = jumpLabels(36);
assert.equal(single.at(-1), 'm');
assert.equal(new Set(single).size, 36);
// Past 36 every row after the tenth takes two letters, and no label begins another.
const pairs = jumpLabels(40);
assert.deepEqual(pairs.slice(8, 13), ['9', '0', 'aa', 'as', 'ad']);
assert.equal(new Set(pairs).size, 40);
for (const a of pairs) for (const b of pairs) if (a !== b) assert.ok(!b.startsWith(a), `${a} begins ${b}`);

// A jump that never cleared its flag stops showing labels after a minute.
assert.equal(jumping({ at: 1000 }, 1000 + 59_000), true);
assert.equal(jumping({ at: 1000 }, 1000 + 61_000), false);
assert.equal(jumping(null, 0), false);

console.log('Herdr agent jump checks passed');
