import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type BashPermissionGateSettings = {
  ask?: string[];
  askCommands?: string[];
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

type Token = { value: string; quoted: boolean };

// Splits a command line into "simple command" segments (one per pipeline
// stage, &&/||/; branch, subshell, command substitution, redirection target,
// etc.). Each token tracks whether any of its characters came from inside
// quotes so callers can ignore quoted data when matching dangerous patterns.
// Returns undefined only when the input cannot be parsed (unterminated quote).
function parseSegments(command: string): Token[][] | undefined {
  const segments: Token[][] = [];
  let tokens: Token[] = [];
  let value = "";
  let quoted = false;
  let hasChar = false;
  let quote: "'" | '"' | undefined;

  const endToken = (): void => {
    if (hasChar) tokens.push({ value, quoted });
    value = "";
    quoted = false;
    hasChar = false;
  };
  const endSegment = (): void => {
    endToken();
    if (tokens.length) {
      segments.push(tokens);
      tokens = [];
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        value += char;
        quoted = true;
        hasChar = true;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      hasChar = true;
      continue;
    }

    if (char === "\\") {
      if (next !== undefined) {
        value += next;
        hasChar = true;
        index += 1;
      }
      continue;
    }

    // Command substitution: treat the inner command as its own segment.
    if (char === "$" && next === "(") {
      endSegment();
      index += 1;
      continue;
    }

    // Shell operators / redirections separate one simple command from another.
    if (
      char === ";" ||
      char === "\n" ||
      char === "&" ||
      char === "|" ||
      char === "(" ||
      char === ")" ||
      char === "<" ||
      char === ">" ||
      char === "`"
    ) {
      endSegment();
      if ((char === "&" || char === "|" || char === ">") && next === char) index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      endToken();
      continue;
    }

    value += char;
    hasChar = true;
  }

  if (quote) return undefined;
  endSegment();
  return segments;
}

// Text used for pattern matching: quoted tokens are dropped so that data
// (e.g. a grep pattern containing "rm -rf") never trips the gate.
function segmentMatchText(segment: Token[]): string {
  return segment
    .filter((token) => !token.quoted)
    .map((token) => token.value)
    .join(" ");
}

function isAllowedRmOption(option: string): boolean {
  return option === "-f" || option === "-r" || option === "-rf" || option === "-fr" || option === "--recursive";
}

function isDirectTmpChild(path: string): boolean {
  const child = path.startsWith("/tmp/") ? path.slice("/tmp/".length) : undefined;
  return Boolean(child) && child !== "." && child !== ".." && !child?.includes("/");
}

// True when an `rm` segment only removes direct children of /tmp using
// recursive/force flags — safe enough to skip the prompt. Uses unquoted token
// values, so quoting flags or paths cannot smuggle a dangerous rm past us.
function isSafeTmpRm(segment: Token[]): boolean {
  let sawPath = false;
  let parsingOptions = true;

  for (const token of segment.slice(1)) {
    const value = token.value;
    if (parsingOptions && value === "--") {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && value.startsWith("-") && value !== "-") {
      if (!isAllowedRmOption(value)) return false;
      continue;
    }

    sawPath = true;
    if (!isDirectTmpChild(value)) return false;
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

    // Block list is matched against the raw command (no quote stripping) so an
    // explicit deny cannot be evaded by quoting.
    if (blockPatterns.some((pattern) => pattern.test(command))) {
      return { block: true, reason: "Command blocked by permissionGate.bash.block" };
    }

    const askCommands = new Set(settings.askCommands ?? []);
    const segments = parseSegments(command.trim());

    let needsAsk: boolean;
    if (!segments) {
      // Unparseable (unterminated quote): fall back to whole-command matching.
      needsAsk = askPatterns.some((pattern) => pattern.test(command));
    } else {
      needsAsk = segments.some((segment) => {
        const first = segment[0];
        if (!first || first.quoted) return false;

        // `rm` has path semantics: ask unless it is a proven-safe /tmp cleanup.
        if (first.value === "rm" && askCommands.has("rm")) {
          return !isSafeTmpRm(segment);
        }

        // Other command rules are structural: only the command position counts,
        // so grep/echo data containing "sudo" never trips the gate.
        if (askCommands.has(first.value)) return true;

        const text = segmentMatchText(segment);
        return text.length > 0 && askPatterns.some((pattern) => pattern.test(text));
      });
    }

    if (!needsAsk) return undefined;

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
