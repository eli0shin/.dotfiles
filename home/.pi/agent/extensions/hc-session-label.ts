import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// herdr-core does not know which session a Pi terminal runs, unlike legacy
// herdr's agent_session. agent-status reads this label instead.
export const SESSION_LABEL = "dotfiles.pi_session";

export default function hcSessionLabel(pi: ExtensionAPI): void {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return;
  let labeled: string | undefined;

  function label(ctx: ExtensionContext): void {
    // Headless modes share the terminal of the Pi that started them.
    if (ctx.mode !== "tui") return;
    const file = ctx.sessionManager.getSessionFile();
    if (!file?.startsWith("/") || file === labeled) return;
    labeled = file;
    execFile("hc", ["label", terminal!, `${SESSION_LABEL}=${file}`], { timeout: 5000 }, (error) => {
      if (error && labeled === file) labeled = undefined;
    });
  }

  pi.on("session_start", async (_event, ctx) => label(ctx));
  pi.on("agent_start", async (_event, ctx) => label(ctx));
}
