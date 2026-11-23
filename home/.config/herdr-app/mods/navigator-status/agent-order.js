// Numbered agent focus (legacy Ctrl+G, Shift+1–9). The app has no "agent N"
// command, so this focuses the Nth row of the `eli-agents` sidebar list, which
// shows each row's number. That mod publishes its order in shared state; it is
// used only while it still describes the current agents. Otherwise (the sidebar
// hasn't been shown since launch, or hasn't redrawn yet) this mirrors the
// list's sort: pinned first, then (priority sort) the most urgent agent, a
// parent ranking with its most urgent sub-agent, ties by most recent change.
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// agent-10 is Shift+0, the tenth row's 0.
const COMMAND = /^agent-([1-9]|10)$/;
// Keep in sync with eli-agents/main.js.
export const ORDER_KEY = "dotfiles.agents.order";
// Keep in sync with eli-agents/main.js and agent-machines/main.js: agents on
// these machines ("" is this computer) are left out of the list and its order.
export const HIDDEN_MACHINES_KEY = "dotfiles.agents.hidden-machines";
const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : "");
export const orderInputs = (list, sort) => [sort ?? "", list.find((a) => a.focused)?.address ?? "", ...list.map((a) => `${a.address}:${a.status}:${a.pinned ? 1 : 0}`)].join("\n");

function subAgentRank(all, listed, address) {
  let best = 0;
  for (const kid of all) {
    if (kid.parent !== address || kid.state !== "live") continue;
    const raw = listed.get(kid.address) ?? kid.status;
    const status = raw === "error" ? "blocked" : raw === "done" ? "idle" : raw;
    best = Math.max(best, RANK[status] ?? 0, subAgentRank(all, listed, kid.address));
  }
  return best;
}

export function orderAgents(list, all, sort) {
  let ordered = list;
  if (sort !== "grouped") {
    const listed = new Map(list.map((a) => [a.address, a.status]));
    const rank = new Map(list.map((a) => [a.address, Math.max(RANK[a.status] ?? 0, subAgentRank(all, listed, a.address))]));
    ordered = [...list].sort((x, y) => rank.get(y.address) - rank.get(x.address) || y.seq - x.seq);
  }
  return [...ordered.filter((a) => a.pinned), ...ordered.filter((a) => !a.pinned)];
}

function sidebarOrder(list, sort, published) {
  if (!published || published.inputs !== orderInputs(list, sort)) return null;
  const byAddress = new Map(list.map((a) => [a.address, a]));
  return published.addresses.map((address) => byAddress.get(address)).filter(Boolean);
}

// The Agents list's order for `list`, given the sort, published order and hidden
// machines read with it. Agents on hidden machines aren't in it, as in the list.
export function agentOrder(list, { terminals, sort, published, hidden }) {
  const off = new Set(hidden ?? []);
  const shown = off.size ? list.filter((a) => !off.has(machineOf(a))) : list;
  return sidebarOrder(shown, sort, published) ?? orderAgents(shown, terminals(), sort);
}

// Returns true when it handled the command.
export function focusNumberedAgent(command, { agents, terminals, shared, run }) {
  const n = COMMAND.exec(command)?.[1];
  if (!n) return false;
  const ordered = agentOrder(agents(), { terminals, sort: shared("agents.sort"), published: shared(ORDER_KEY), hidden: shared(HIDDEN_MACHINES_KEY) });
  const agent = ordered[Number(n) - 1];
  if (agent) run("agent.focus", { terminal: agent.address });
  return true;
}
