#!/usr/bin/env node
// eli-agents reads pr-watch.ts's terminal label to nest Pi workers under their
// orchestrator and list the PRs each Pi session watches.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WATCH_LABEL, orchestrations, piWatch, watchText } from '../home/.config/herdr-app/mods/eli-agents/watch.js';

// The label key is the one Pi writes and the fish hook clears.
const piSource = readFileSync(new URL('../home/.pi/agent/extensions/pr-watch.ts', import.meta.url), 'utf8');
assert.match(piSource, new RegExp(`TERMINAL_LABEL = "${WATCH_LABEL}"`));
const fishHook = readFileSync(new URL('../home/.config/fish/conf.d/hc-pi-resume.fish', import.meta.url), 'utf8');
assert.match(fishHook, new RegExp(`${WATCH_LABEL}= `));

const pi = (label, program = 'pi') => ({ program: { key: program }, labels: label == null ? {} : { [WATCH_LABEL]: label } });
assert.deepEqual(piWatch(pi('{"prs":["#1901"]}')), { prs: ['#1901'] });
// A label another program inherited from a Pi that exited is ignored.
assert.equal(piWatch(pi('{"prs":["#1901"]}', 'claude')), null);
assert.equal(piWatch(pi(null)), null);
assert.equal(piWatch(pi('not json')), null);
assert.equal(piWatch(pi('["#1"]')), null);
assert.equal(piWatch(undefined), null);

assert.equal(watchText({ prs: ['#1901', 'tool#7'] }), '#1901, tool#7');
assert.equal(watchText({ prs: ['#1867'], paused: true }), '#1867 · paused');
assert.equal(watchText({ sha: 'merge of #1850' }), 'merge of #1850');
assert.equal(watchText({ role: 'worker', orchestration: 'o1' }), null);
assert.equal(watchText(null), null);

const watch = {
  orch: { role: 'orchestrator', orchestration: 'o1' },
  w1: { role: 'worker', orchestration: 'o1' },
  w2: { role: 'worker', orchestration: 'o1' },
  orphan: { role: 'worker', orchestration: 'gone' },
  solo: { prs: ['#1780'] },
};
const list = ['w1', 'solo', 'orch', 'orphan', 'w2'].map((address) => ({ address }));
const { workers, nested } = orchestrations(list, (a) => watch[a.address]);
// Workers keep list order under their orchestrator; a worker without one stays a row.
assert.deepEqual(workers.get('orch').map((a) => a.address), ['w1', 'w2']);
assert.deepEqual([...nested].sort(), ['w1', 'w2']);
assert.equal(workers.has('orphan'), false);

console.log('Herdr agent watch label checks passed');
