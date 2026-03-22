import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROTECTED_PATHS = [".env", ".git/", "node_modules/", "auth.json", "settings.local.json"];

export default function protectedPaths(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

    const path = event.input.path as string;
    const blocked = PROTECTED_PATHS.some((segment) => path.includes(segment));

    if (!blocked) return undefined;

    if (ctx.hasUI) {
      ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
    }

    return { block: true, reason: `Path is protected: ${path}` };
  });
}
