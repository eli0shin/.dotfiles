import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// herdr-core does not know which session a Pi terminal runs, unlike legacy
// herdr's agent_session. agent-status reads this label instead, and the fish
// hook conf.d/hc-pi-resume.fish resumes it when the terminal is reopened.
export const SESSION_LABEL = "dotfiles.pi_session";
// The token of the fish shell Pi runs under. A reopened terminal starts a
// shell with a new token, which is how the hook tells it apart.
export const SHELL_LABEL = "dotfiles.pi_shell";

export function markerDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "dotfiles", "hc-pi");
}

export default function hcSessionLabel(pi: ExtensionAPI): void {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return;
  const shell = process.env.DOTFILES_HC_SHELL;

  // Relabel on every turn: the shell clears the label when Pi returns to it,
  // including when Pi is suspended and later resumed with fg.
  function label(ctx: ExtensionContext): void {
    // Headless modes share the terminal of the Pi that started them.
    if (ctx.mode !== "tui") return;
    const file = ctx.sessionManager.getSessionFile();
    if (!file?.startsWith("/")) return;
    if (shell) {
      // The marker tells the shell, without asking hc, that it has a label to clear.
      try {
        mkdirSync(markerDir(), { recursive: true });
        writeFileSync(join(markerDir(), shell), `${terminal}\n`);
      } catch {
        // Without a marker the label outlives this Pi; resuming still works.
      }
    }
    execFile("hc", ["label", terminal!, `${SESSION_LABEL}=${file}`, `${SHELL_LABEL}=${shell ?? ""}`], { timeout: 5000 }, () => {});
  }

  pi.on("session_start", async (_event, ctx) => label(ctx));
  pi.on("agent_start", async (_event, ctx) => label(ctx));
}
