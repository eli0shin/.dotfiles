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

function tokenizeSimpleCommand(command: string): string[] | undefined {
  if (/[;&|`$()<>\n]/.test(command)) return undefined;

  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        token += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += char;
  }

  if (quote) return undefined;
  if (token) tokens.push(token);
  return tokens;
}

function isAllowedRmOption(option: string): boolean {
  return option === "-f" || option === "-r" || option === "-rf" || option === "-fr" || option === "--recursive";
}

function isDirectTmpChild(path: string): boolean {
  const child = path.startsWith("/tmp/") ? path.slice("/tmp/".length) : undefined;
  return Boolean(child) && child !== "." && child !== ".." && !child?.includes("/");
}

function isTmpRmCommand(command: string): boolean {
  const tokens = tokenizeSimpleCommand(command.trim());
  if (!tokens || tokens[0] !== "rm") return false;

  let sawPath = false;
  let parsingOptions = true;

  for (const token of tokens.slice(1)) {
    if (parsingOptions && token === "--") {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && token.startsWith("-") && token !== "-") {
      if (!isAllowedRmOption(token)) return false;
      continue;
    }

    sawPath = true;
    if (!isDirectTmpChild(token)) return false;
  }

  return sawPath;
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

    if (isTmpRmCommand(command)) return undefined;

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
