// Agents are reached through the Agents list only, so tab keys never land on
// an agent's tab: numbered tabs (Cmd+1–9, Ctrl+G 1–9) count only the tabs the
// `eli-tabs` bar shows, and next/prev (Ctrl+G N/P, Ctrl+Tab, Cmd+Shift+]/[,
// scrolling the bar) step over hidden ones. The app's tab.select {index} and
// tab.next/prev would count them.
const NUMBERED = /^tab-([1-9])$/;
const STEP = { "tab-next": 1, "tab-prev": -1 };

// Keep in sync with eli-tabs/main.js (mods can't import each other's files).
export function agentTabIds(agents) {
  return new Set(agents.map(a => a.tab));
}

export function visibleTabs(space, agents) {
  const hidden = agentTabIds(agents);
  return (space?.tabs ?? []).filter(tab => !hidden.has(tab.id));
}

// The next shown tab after the active one (which may be a hidden agent tab),
// wrapping. Settled tabs are skipped, as the app's tab.next/prev skip them.
function stepTab(space, agents, by) {
  const tabs = space?.tabs ?? [];
  const hidden = agentTabIds(agents);
  const active = tabs.findIndex(tab => tab.active);
  // No active tab: next starts at the first tab, prev at the last.
  const from = active >= 0 ? active : by > 0 ? -1 : tabs.length;
  for (let i = 1; i <= tabs.length; i++) {
    const tab = tabs[((from + by * i) % tabs.length + tabs.length) % tabs.length];
    // Back around to the active tab: it's the only one shown.
    if (!hidden.has(tab.id) && !tab.settled) return tab.active ? null : tab;
  }
  return null;
}

// Returns true when it handled the command.
export function selectTab(command, { spaces, agents, run }) {
  const n = NUMBERED.exec(command)?.[1];
  if (!n && !(command in STEP)) return false;
  const space = spaces().find(s => s.active);
  const tab = n ? visibleTabs(space, agents())[Number(n) - 1] : stepTab(space, agents(), STEP[command]);
  if (tab) run("tab.select", { id: tab.id });
  return true;
}
