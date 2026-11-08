// Numbered agent focus (legacy Ctrl+G, Shift+1–9). The app has no "agent N"
// command, so this focuses the Nth row of the `eli-agents` sidebar list, which
// shows each row's number. That mod publishes its order in shared state; it is
// used only while it still describes the current agents. Otherwise (the sidebar
// hasn't been shown since launch, or hasn't redrawn yet) this mirrors the
// list's sort: pinned first, then (priority sort) the most urgent agent, a
// parent ranking with its most urgent sub-agent, ties by most recent change.
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const COMMAND = /^agent-([1-9])$/;
// Keep in sync with eli-agents/main.js.
const ORDER_KEY = "dotfiles.agents.order";
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

// Returns true when it handled the command.
export function focusNumberedAgent(command, { agents, terminals, shared, run }) {
  const n = COMMAND.exec(command)?.[1];
  if (!n) return false;
  const list = agents();
  const sort = shared("agents.sort");
  const ordered = sidebarOrder(list, sort, shared(ORDER_KEY)) ?? orderAgents(list, terminals(), sort);
  const agent = ordered[Number(n) - 1];
  if (agent) run("agent.focus", { terminal: agent.address });
  return true;
}
