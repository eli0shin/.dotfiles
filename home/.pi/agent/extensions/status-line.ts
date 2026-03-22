import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function statusLine(pi: ExtensionAPI): void {
  let turnCount = 0;

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("turn-status", ctx.ui.theme.fg("dim", "ready"));
  });

  pi.on("turn_start", async (_event, ctx) => {
    turnCount += 1;
    const prefix = ctx.ui.theme.fg("accent", "*");
    const text = ctx.ui.theme.fg("dim", ` turn ${turnCount} running`);
    ctx.ui.setStatus("turn-status", prefix + text);
  });

  pi.on("turn_end", async (_event, ctx) => {
    const prefix = ctx.ui.theme.fg("success", "OK");
    const text = ctx.ui.theme.fg("dim", ` turn ${turnCount} complete`);
    ctx.ui.setStatus("turn-status", prefix + text);
  });

  pi.on("session_switch", async (event, ctx) => {
    if (event.reason !== "new") return;

    turnCount = 0;
    ctx.ui.setStatus("turn-status", ctx.ui.theme.fg("dim", "ready"));
  });
}
