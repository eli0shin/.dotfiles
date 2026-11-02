import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, matchesKey, parseKey, type KeybindingsManager } from "@earendil-works/pi-tui";

export function enableCtrlEscapeInterrupt(keys: KeybindingsManager): () => void {
  // Pi 1.4 parses modified Escape but matchesKey rejects every Escape modifier.
  // Adapt the active manager, not raw input or abort(), to retain native handling
  // of autocomplete, retries, compaction, shell commands, and agent interruption.
  if (matchesKey("\x1b[27;5u", "ctrl+escape")) return () => {};
  const original = keys.matches;
  const matches: typeof keys.matches = function (this: KeybindingsManager, data, action) {
    if (action === "app.interrupt" && parseKey(data) === "ctrl+escape" &&
        this.getKeys(action).some((key) => key === "ctrl+escape" || key === "ctrl+esc")) return true;
    return original.call(this, data, action);
  };
  keys.matches = matches;
  return () => { if (keys.matches === matches) keys.matches = original; };
}

export default function ctrlEscapeInterrupt(pi: ExtensionAPI): void {
  let restore: (() => void) | undefined;
  const cleanup = () => { restore?.(); restore = undefined; };
  pi.on("session_start", (_event, ctx) => {
    cleanup();
    if (ctx.mode === "tui") restore = enableCtrlEscapeInterrupt(getKeybindings());
  });
  pi.on("session_shutdown", cleanup);
}
