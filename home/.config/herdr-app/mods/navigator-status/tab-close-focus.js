import { agentTabIds } from "./tab-order.js";

// Closing the shown tab shows the one to its left, like the Herdr TUI
// (Workspace::close_tab); the app picks the one to its right. Closing the
// first tab keeps the app's choice, the new first tab, as the TUI does.
// Settled tabs are skipped, as tab.next/prev skip them, and so are agents' tabs,
// which the `eli-tabs` bar hides: with none to the left, the nearest shown tab
// to the right. Closing an agent's tab goes to the next agent in the Agents
// list instead (wrapping), as the list is how agents are reached; with no other
// agent, to a shown tab as above. Only the shown space: tab.select also shows
// its space, so a background close keeps the app's choice.
export function createTabCloseFocus({ run }) {
  // Space id -> the tab order, shown tab and agents (with their list order) last seen.
  const seen = new Map();

  // The agent after the closed tab's agents in the list order before the close.
  function nextAgent(before, agents) {
    const closed = before.active;
    const order = before.order();
    const live = new Set(agents.map((a) => a.address));
    const at = Math.max(...order.map((a, i) => (a.tab === closed ? i : -1)));
    for (let i = 1; i <= order.length; i++) {
      const agent = order[(at + i) % order.length];
      if (agent.tab !== closed && live.has(agent.address)) return agent;
    }
    return null;
  }

  return {
    // agents: agents() now; order: a function giving them in the Agents list order.
    onSpacesChanged(list, agents = [], order = () => agents) {
      const live = new Set();
      const agentTabs = agentTabIds(agents);
      for (const space of list) {
        live.add(space.id);
        const tabs = space.tabs.map((t) => t.id);
        let active = space.tabs.find((t) => t.active)?.id;
        const before = seen.get(space.id);
        // No shown tab yet (mid-update): keep the last view to compare against.
        if (!active) continue;
        if (space.active && before && !tabs.includes(before.active)) {
          const agent = before.agents.some((a) => a.tab === before.active) ? nextAgent(before, agents) : null;
          if (agent) {
            run("agent.focus", { terminal: agent.address });
            if (agent.space === space.id) active = agent.tab;
          } else {
            const open = new Map(space.tabs.map((t) => [t.id, t]));
            const at = before.tabs.indexOf(before.active);
            const nearest = [...before.tabs.slice(0, at).reverse(), ...before.tabs.slice(at + 1)];
            const target = nearest.find((id) => open.has(id) && !open.get(id).settled && !agentTabs.has(id));
            if (target && target !== active) {
              run("tab.select", { id: target });
              active = target;
            }
          }
        }
        seen.set(space.id, { tabs, active, agents, order });
      }
      for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
    },
  };
}
