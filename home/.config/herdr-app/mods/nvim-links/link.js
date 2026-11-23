// Cmd-click on a file path in a terminal: open it in Neovim in a new split to
// the right of the pane you clicked in, at the line it names (file.rs:42).
// The split runs on the clicked pane's machine. Folders, non-text files and
// paths that don't exist there go to Herdr's usual opener.

import { exec, run } from "herdr";
import { planOpen, planRemote, remoteLookup } from "./open.js";

async function find(click) {
  const lookup = remoteLookup(click);
  if (!lookup) {
    const local = planOpen(click);
    if (!local) return null;
    const folder = await exec("test", ["-d", local.path]).then((r) => r.code === 0, () => false);
    return folder ? null : local;
  }
  // `test -f` there already skips folders.
  const found = await exec("sh", lookup.args, { on: lookup.machine, timeout: 10000 }).catch(() => null);
  return found?.code === 0 ? planRemote(click, lookup, found.stdout) : null;
}

export async function handleLink(click) {
  const plan = await find(click);
  if (!plan) return "pass";
  // Without a pane (a layout terminal block) the split goes beside the focused one.
  run("pane.split", { direction: "right", argv: plan.argv, ...(plan.pane ? { pane: plan.pane } : {}) });
  return "handled";
}
