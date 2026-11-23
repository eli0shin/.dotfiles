// Cmd-click on a file path in a terminal: open it in Neovim in a new split to
// the right of the pane you clicked in, at the line it names (file.rs:42).
// Folders, non-text files and paths that don't exist here go to Herdr's usual
// opener.

import { exec, run } from "herdr";
import { planOpen } from "./open.js";

export async function handleLink(click) {
  const plan = planOpen(click);
  if (!plan) return "pass";
  const folder = await exec("test", ["-d", plan.path]).then((r) => r.code === 0, () => false);
  if (folder) return "pass";
  // Without a pane (a layout terminal block) the split goes beside the focused one.
  run("pane.split", { direction: "right", argv: plan.argv, ...(plan.pane ? { pane: plan.pane } : {}) });
  return "handled";
}
