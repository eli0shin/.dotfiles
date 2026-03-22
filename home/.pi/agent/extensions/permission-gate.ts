import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DANGEROUS_PATTERNS = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\b(chmod|chown)\b.*777/i,
];

export default function permissionGate(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    const isDangerous = DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));

    if (!isDangerous) return undefined;

    if (!ctx.hasUI) {
      return { block: true, reason: "Dangerous command blocked without interactive confirmation" };
    }

    const choice = await ctx.ui.select(`Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);
    if (choice !== "Yes") {
      return { block: true, reason: "Blocked by user" };
    }

    return undefined;
  });
}
