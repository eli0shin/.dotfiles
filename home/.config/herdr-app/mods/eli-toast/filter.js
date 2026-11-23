// Whether a notification is about an agent on a hidden machine. Pure: no
// Herdr imports, so tests/herdr-app-agent-machines.mjs loads it directly.
// Herdr's agent notes click through to agent.focus on the agent's terminal
// (an address like `work-mac/t3x`, bare on this computer); a pane id is
// mapped through panes(). Anything else isn't an agent's note and shows.
export function hiddenAgentNote(action, hiddenMachines, panes = []) {
  if (!hiddenMachines.length || !action?.args) return false;
  const terminal = action.args.terminal ?? panes.find((p) => p.pane === action.args.pane)?.terminal;
  if (typeof terminal !== "string" || !terminal) return false;
  const machine = terminal.includes("/") ? terminal.split("/")[0] : "";
  return hiddenMachines.includes(machine);
}
