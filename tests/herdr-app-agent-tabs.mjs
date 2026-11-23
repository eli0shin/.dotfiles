#!/usr/bin/env node
// Run: node tests/herdr-app-agent-tabs.mjs
// The Agents list is how agents are reached, so the tab bar shows only other tabs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const home = new URL('../home/.config/herdr-app/', import.meta.url);
const root = new URL('mods/eli-tabs/', home);
const { selectTab } = await import(new URL('mods/navigator-status/tab-order.js', home));
const naming = readFileSync(new URL('names.js', root), 'utf8').replace(/^export /gm, '');
const source = naming + '\n' + readFileSync(new URL('main.js', root), 'utf8');

// Record element ids and text in place of native paint.
function element() {
  const node = { elementId: null, nodes: [] };
  const chain = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'id') return id => { node.elementId = id; return chain; };
      if (key === 'child') return child => { node.nodes.push(child); return chain; };
      if (key === 'children') return children => { node.nodes.push(...children); return chain; };
      if (key === 'when') return (condition, apply) => condition ? apply(chain) : chain;
      if (key === 'on_scroll_wheel') return handler => { node.scroll = handler; return chain; };
      return () => chain;
    },
  });
  return chain;
}
function collect(node, out = { ids: [], text: [] }) {
  if (typeof node === 'string') out.text.push(node);
  else if (node && typeof node === 'object') {
    if (node.elementId) out.ids.push(node.elementId);
    node.nodes.forEach(child => collect(child, out));
  }
  return out;
}

let state, ran = [];
const Tabs = vm.runInNewContext(source.replace(/^import .*;\n/gm, '').replace('export default class Tabs', 'class Tabs') + '\nTabs;', {
  View: class {},
  div: element, h_flex: element, svg: element, image: element,
  spaces: () => [{ id: 'space', active: true, tabs: state.tabs }],
  panes: () => state.panes,
  agents: () => state.agents,
  theme: () => ({}), layout: () => ({}), window: () => ({}), settings: () => ({ zoom: 1 }),
  shared: () => null, run: (...call) => ran.push(call), openOverlay: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
});
function render(next) {
  state = next;
  const view = new Tabs();
  view.init();
  const tree = view.render();
  return { ...collect(tree), scroll: tree.scroll };
}
const tabIds = ids => ids.filter(id => id.startsWith('tab-') && id !== 'tab-machine' && id !== 'tab-scroll');
const program = key => ({ key, name: key, icon: null, agent: key === 'pi' });

const tabs = [
  { id: 'a', name: '1', index: 1 },
  { id: 'b', name: 'editor', named: true, index: 2, active: true },
  { id: 'c', name: '3', index: 3 },
  { id: 'd', name: '4', index: 4 },
];
const panes = [
  { tab: 'a', program: program('pi'), app: 'pi', title: 'π - fix bug - repo', cwd: '/x/repo' },
  { tab: 'b', program: program('nvim') },
  // A split tab with an agent beside a shell is still an agent's tab.
  { tab: 'c', program: program('shell') },
  { tab: 'c', program: program('claude') },
  { tab: 'd', program: program('shell') },
];
const agents = [{ tab: 'a', address: 't1' }, { tab: 'c', address: 't2' }];

let out = render({ tabs, panes, agents });
assert.deepEqual(tabIds(out.ids), ['tab-b', 'tab-d'], 'Tabs with agents must be hidden; others shown');
assert.ok(!out.text.includes('fix bug'), 'A hidden agent tab must not render its name');
// An unnamed tab reads as its place among the shown tabs (as Cmd+1–9 count), not among all tabs.
assert.ok(out.text.includes('2') && !out.text.includes('4'), 'Unnamed tab d is the 2nd shown tab, not the 4th tab');
assert.ok(out.text.includes('editor'), 'A named tab keeps its name');

// The active tab is hidden too when an agent runs in it.
out = render({ tabs: tabs.map(t => ({ ...t, active: t.id === 'a' })), panes, agents });
assert.deepEqual(tabIds(out.ids), ['tab-b', 'tab-d']);
assert.ok(!out.ids.includes('close-a'), 'A hidden active tab must not draw its close button');

// A program that hasn't reported agent status isn't in the Agents list, so its tab stays reachable here.
out = render({ tabs, panes, agents: [] });
assert.deepEqual(tabIds(out.ids), ['tab-a', 'tab-b', 'tab-c', 'tab-d']);

// The bar ends with where the space runs, even when every tab is an agent's; no new-tab button.
out = render({ tabs: tabs.slice(0, 1), panes, agents });
assert.deepEqual(tabIds(out.ids), []);
assert.ok(out.ids.includes('tab-machine') && out.text.includes('This computer'));
assert.ok(!out.ids.includes('tab-new'));

// Cmd+1–9 and Ctrl+G 1–9 number the shown tabs, skipping agents' tabs.
const select = (command, next) => {
  state = next;
  const calls = [];
  // The Agents list order can differ from agents(): here, reversed.
  const order = list => [...list].reverse();
  const handled = selectTab(command, { spaces: () => [{ id: 'other', tabs: [{ id: 'z' }] }, { id: 'space', active: true, tabs: state.tabs }], agents: () => state.agents, run: (name, args) => calls.push([name, args]), order });
  return { handled, calls };
};
const shownIds = tabIds(render({ tabs, panes, agents }).ids).map(id => id.slice('tab-'.length));
for (const [i, id] of shownIds.entries()) {
  assert.deepEqual(select(`tab-${i + 1}`, { tabs, agents }).calls, [['tab.select', { id }]], `Tab ${i + 1} must be the bar's ${i + 1}th shown tab`);
}
assert.deepEqual(select('tab-3', { tabs, agents }), { handled: true, calls: [] }, 'A number past the shown tabs does nothing');
assert.deepEqual(select('tab-2', { tabs, agents: [] }).calls, [['tab.select', { id: 'b' }]], 'Without agents every tab counts');
assert.equal(select('agent-1', { tabs, agents }).handled, false, 'Other commands pass through');

// Next/prev step over agents' tabs (a, c hidden; b, d shown), wrapping.
const on = id => tabs.map(t => ({ ...t, active: t.id === id }));
const step = (command, active, extra = {}) => select(command, { tabs: on(active), agents, ...extra }).calls.map(([, args]) => args.id);
assert.deepEqual(step('tab-next', 'b'), ['d']);
assert.deepEqual(step('tab-next', 'd'), ['b'], 'Next wraps past the hidden first tab');
assert.deepEqual(step('tab-prev', 'b'), ['d'], 'Prev wraps past the hidden first tab');
assert.deepEqual(step('tab-prev', 'd'), ['b']);
// On an agent's tab, next/prev move down/up the Agents list instead, wrapping.
const stepAgents = (command, active, list) => select(command, { tabs: on(active), agents: list }).calls;
const listed = [{ tab: 'a', address: 't1' }, { tab: 'c', address: 't2' }, { tab: 'd', address: 't3' }];
// List order (reversed): t3, t2, t1.
assert.deepEqual(stepAgents('tab-next', 'c', listed), [['agent.focus', { terminal: 't1' }]], 'Next is the row below in the Agents list');
assert.deepEqual(stepAgents('tab-prev', 'c', listed), [['agent.focus', { terminal: 't3' }]], 'Prev is the row above');
assert.deepEqual(stepAgents('tab-next', 'a', listed), [['agent.focus', { terminal: 't3' }]], 'Next wraps from the last row');
assert.deepEqual(stepAgents('tab-prev', 'd', listed), [['agent.focus', { terminal: 't1' }]], 'Prev wraps from the first row');
// A split tab with two agents: from the focused one.
const split = [{ tab: 'a', address: 't1' }, { tab: 'c', address: 't2' }, { tab: 'c', address: 't4', focused: true }];
// List order: t4, t2, t1.
assert.deepEqual(stepAgents('tab-next', 'c', split), [['agent.focus', { terminal: 't2' }]]);
// The only agent: nothing to move to, and never a tab.
assert.deepEqual(stepAgents('tab-next', 'a', [{ tab: 'a', address: 't1' }]), []);
// An agent the list order leaves out (a worker under a folded orchestrator) starts outside it.
const folded = command => {
  state = { tabs: on('c'), agents: listed };
  const calls = [];
  selectTab(command, { spaces: () => [{ id: 'space', active: true, tabs: state.tabs }], agents: () => listed, run: (...call) => calls.push(call), order: () => listed.filter(a => a.tab !== 'c') });
  return calls;
};
assert.deepEqual(folded('tab-next'), [['agent.focus', { terminal: 't1' }]], 'Next from outside the list is the top row');
assert.deepEqual(folded('tab-prev'), [['agent.focus', { terminal: 't3' }]], 'Prev from outside the list is the bottom row');
// Numbers still count shown tabs from an agent's tab.
assert.deepEqual(select('tab-1', { tabs: on('a'), agents }).calls, [['tab.select', { id: 'b' }]]);
// The only shown tab: nothing to step to.
assert.deepEqual(select('tab-next', { tabs: on('b').slice(0, 2), agents }).calls, []);
// Settled tabs are skipped, as the app's tab.next does.
assert.deepEqual(select('tab-next', { tabs: on('b').map(t => t.id === 'd' ? { ...t, settled: true } : t), agents }).calls, []);
assert.deepEqual(step('tab-next', 'b', { agents: [] }), ['c'], 'Without agents every tab counts');

// Scrolling the bar steps the same way, through navigator-status.
const bar = render({ tabs: on('b'), panes, agents });
ran = [];
bar.scroll({ delta: { y: -3 } });
bar.scroll({ delta: { y: 3 } });
assert.deepEqual(ran, [['navigator-status.tab-next'], ['navigator-status.tab-prev']]);

const keys = JSON.parse(readFileSync(new URL('keys.json', home)))['layout:eli'];
for (let n = 1; n <= 9; n++) {
  for (const chord of [`cmd-${n}`, `ctrl-g ${n}`]) assert.equal(keys[chord], `navigator-status.tab-${n}`, `${chord} must count shown tabs in the eli layout`);
}
const global = JSON.parse(readFileSync(new URL('keys.json', home))).global;
for (const [chord, action] of Object.entries(global)) {
  if (action !== 'tab.next' && action !== 'tab.prev') continue;
  assert.equal(keys[chord], `navigator-status.${action.replace('.', '-')}`, `${chord} must step over agents' tabs in the eli layout`);
}

console.log('Herdr agent tab hiding checks passed');
