import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type BashPermissionGateSettings = {
  ask?: string[];
  block?: string[];
};

type PermissionGateSettings = {
  permissionGate?: {
    bash?: BashPermissionGateSettings;
  };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSettings(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(override)) return override;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? mergeSettings(merged[key], value) : value;
  }
  return merged;
}

function readSettings(path: string): PermissionGateSettings {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as PermissionGateSettings;
}

function loadBashSettings(cwd: string): BashPermissionGateSettings {
  const globalSettings = readSettings(join(homedir(), ".pi", "agent", "settings.json"));
  const projectSettings = readSettings(join(cwd, ".pi", "settings.json"));
  const settings = mergeSettings(globalSettings, projectSettings) as PermissionGateSettings;
  return settings.permissionGate?.bash ?? {};
}

function compilePatterns(patterns: string[] | undefined): RegExp[] {
  return (patterns ?? []).map((pattern) => new RegExp(pattern, "i"));
}

export default function permissionGate(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    const settings = loadBashSettings(ctx.cwd);
    const blockPatterns = compilePatterns(settings.block);
    const askPatterns = compilePatterns(settings.ask);

    if (blockPatterns.some((pattern) => pattern.test(command))) {
      return { block: true, reason: "Command blocked by permissionGate.bash.block" };
    }

    if (!askPatterns.some((pattern) => pattern.test(command))) return undefined;

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
