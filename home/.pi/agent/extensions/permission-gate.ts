import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type RmPolicySettings = {
  allowGitRepositories?: boolean;
  allowTempDirectories?: boolean;
  blockHome?: boolean;
  blockRecursiveOutsideAllowedLocations?: boolean;
};

type BashPermissionGateSettings = {
  ask?: string[];
  askCommands?: string[];
  block?: string[];
  rmPolicy?: RmPolicySettings;
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

type Token = {
  value: string;
  quoted: boolean;
  expandable: boolean;
  singleQuoted: boolean;
  escaped: boolean;
  start: number;
};
type Segment = { tokens: Token[]; separatorAfter?: string; subshellDepth: number };
type RmDecision = "allow" | "ask" | "block";

type SafetyPath = {
  path: string;
  descendantsOnly: boolean;
};

const DEFAULT_RM_POLICY: Required<RmPolicySettings> = {
  allowGitRepositories: true,
  allowTempDirectories: true,
  blockHome: true,
  blockRecursiveOutsideAllowedLocations: true,
};

// Splits a command line into "simple command" segments (one per pipeline
// stage, &&/||/; branch, subshell, command substitution, redirection target,
// etc.). Each token tracks whether any of its characters came from inside
// quotes so callers can ignore quoted data when matching dangerous patterns.
// Returns undefined only when the input cannot be parsed (unterminated quote).
function parseSegments(command: string): Segment[] | undefined {
  const segments: Segment[] = [];
  let tokens: Token[] = [];
  let value = "";
  let quoted = false;
  let expandable = false;
  let singleQuoted = false;
  let escaped = false;
  let hasChar = false;
  let tokenStart = 0;
  let subshellDepth = 0;
  let quote: "'" | '"' | undefined;

  const beginToken = (index: number): void => {
    if (!hasChar) tokenStart = index;
    hasChar = true;
  };
  const endToken = (): void => {
    if (hasChar) tokens.push({ value, quoted, expandable, singleQuoted, escaped, start: tokenStart });
    value = "";
    quoted = false;
    expandable = false;
    singleQuoted = false;
    escaped = false;
    hasChar = false;
  };
  const endSegment = (separatorAfter?: string): void => {
    endToken();
    if (tokens.length) {
      segments.push({ tokens, separatorAfter, subshellDepth });
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
        beginToken(index);
        value += char;
        quoted = true;
        expandable ||= quote === '"';
        singleQuoted ||= quote === "'";
      }
      continue;
    }

    if (char === "'" || char === '"') {
      beginToken(index);
      quote = char;
      continue;
    }

    if (char === "\\") {
      if (next !== undefined) {
        beginToken(index);
        value += next;
        escaped = true;
        index += 1;
      }
      continue;
    }

    // Treat a substitution as an unknown operand of the surrounding command,
    // while still parsing its inner command as a separate segment.
    if (char === "$" && next === "(") {
      endToken();
      if (tokens.length) {
        tokens.push({
          value: "<dynamic-substitution>",
          quoted: false,
          expandable: false,
          singleQuoted: false,
          escaped: false,
          start: index,
        });
      }
      endSegment("$(");
      subshellDepth += 1;
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
      const separator = (char === "&" || char === "|" || char === ">") && next === char ? char + next : char;
      if (char === "`") {
        endToken();
        if (tokens.length) {
          tokens.push({
            value: "<dynamic-substitution>",
            quoted: false,
            expandable: false,
            singleQuoted: false,
            escaped: false,
            start: index,
          });
        }
      }
      endSegment(separator);
      if (char === "(") subshellDepth += 1;
      if (char === ")") subshellDepth = Math.max(0, subshellDepth - 1);
      if (separator.length === 2) index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      endToken();
      continue;
    }

    beginToken(index);
    value += char;
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

function isWithinOrEqual(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function isStrictlyWithin(root: string, path: string): boolean {
  return resolve(root) !== resolve(path) && isWithinOrEqual(root, path);
}

function findGitRoot(path: string): string | undefined {
  let cursor = resolve(path);
  while (true) {
    if (existsSync(resolve(cursor, ".git"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

function safeMktempVariables(command: string, before: number): Set<string> {
  const prefix = command.slice(0, before);
  const safe = new Set<string>();
  const assignment = /(?:^|[;&|\n])\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?\$\(\s*(?:command\s+)?(?:\/usr\/bin\/)?mktemp(?:\s+(?:-[A-Za-z]+|--[A-Za-z-]+))*\s*\)"?\s*(?=$|[;&|\n])/g;

  for (const match of prefix.matchAll(assignment)) {
    const name = match[1];
    const tail = prefix.slice((match.index ?? 0) + match[0].length);
    const beforeAssignment = prefix.slice(0, match.index ?? 0);
    const immediatelyUsed = /^[\s;&|]*$/.test(tail);
    const tempDirectoryOverridden = /(?:^|[;&|\n])\s*(?:export\s+)?TMPDIR\s*=/.test(beforeAssignment);
    const previouslyReadonly = new RegExp(`\\breadonly(?:\\s+-[A-Za-z]+)*\\s+${name}(?:=|\\s|$)`).test(
      beforeAssignment,
    );
    if (immediatelyUsed && !tempDirectoryOverridden && !previouslyReadonly) safe.add(name);
  }
  return safe;
}

function isSymbolicTempPath(token: Token, safeVariables: Set<string>): boolean {
  if (token.singleQuoted || token.escaped) return false;
  const match = token.value.match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))(.*)$/);
  if (!match || !safeVariables.has(match[1] ?? match[2])) return false;

  const suffix = match[3];
  if (suffix && !suffix.startsWith("/")) return false;
  const symbolicRoot = "/tmp/mktemp-result";
  return isWithinOrEqual(symbolicRoot, resolve(symbolicRoot, `.${suffix}`));
}

function resolveExistingParents(path: string, descendantsOnly: boolean): string {
  let cursor = descendantsOnly ? path : dirname(path);
  const suffix: string[] = descendantsOnly ? [] : [basename(path)];

  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return path;
    suffix.unshift(basename(cursor));
    cursor = parent;
  }

  const canonical = realpathSync(cursor);
  return resolve(canonical, ...suffix);
}

function safetyPath(token: Token, cwd: string | undefined): SafetyPath | undefined {
  if (token.value === "<dynamic-substitution>") return undefined;
  let expanded = token.value;
  if (!token.quoted && !token.escaped && expanded === "~") expanded = homedir();
  else if (!token.quoted && !token.escaped && expanded.startsWith("~/")) {
    expanded = resolve(homedir(), expanded.slice(2));
  }

  const knownVariables: Record<string, string> = {
    HOME: homedir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
  };
  if (!token.singleQuoted && !token.escaped) {
    expanded = expanded.replace(
      /\$(?:\{(HOME|TMPDIR)\}|(HOME|TMPDIR))(?=\/|$)/g,
      (_match, braced, plain) => knownVariables[braced ?? plain],
    );
  }
  if (expanded.includes("$") || expanded.includes("`") || /[{}]/.test(expanded)) return undefined;
  if (!cwd && !isAbsolute(expanded)) return undefined;
  const baseCwd = cwd ?? "/";

  const globIndex = expanded.search(/[*?[\]]/);
  if (globIndex === -1) {
    const path = resolve(baseCwd, expanded);
    return { path: resolveExistingParents(path, false), descendantsOnly: false };
  }
  const dynamicSuffix = expanded.slice(globIndex);
  if (dynamicSuffix.split("/").includes("..") || dynamicSuffix.includes("/")) return undefined;

  const staticPrefix = expanded.slice(0, globIndex);
  const base = resolve(baseCwd, staticPrefix.endsWith("/") ? staticPrefix : dirname(staticPrefix || "."));
  return { path: resolveExistingParents(base, true), descendantsOnly: true };
}

function isAllowedLocation(target: SafetyPath, policy: Required<RmPolicySettings>): boolean {
  const tempRoots = [tmpdir(), "/tmp", "/private/tmp"].map((root) =>
    existsSync(root) ? realpathSync(root) : resolve(root),
  );
  if (
    policy.allowTempDirectories &&
    tempRoots.some((root) =>
      target.descendantsOnly ? isWithinOrEqual(root, target.path) : isStrictlyWithin(root, target.path),
    )
  ) {
    return true;
  }

  if (!policy.allowGitRepositories) return false;
  const gitRoot = findGitRoot(target.path);
  return Boolean(gitRoot && isWithinOrEqual(gitRoot, target.path));
}

function rmDecision(
  segment: Token[],
  command: string,
  cwd: string | undefined,
  settings: RmPolicySettings | undefined,
): RmDecision {
  const policy = { ...DEFAULT_RM_POLICY, ...settings };
  const safeVariables = safeMktempVariables(command, segment[0]?.start ?? 0);
  const paths: Token[] = [];
  let recursive = false;
  let recursiveOptionUnknown = false;
  let parsingOptions = true;

  for (const token of segment.slice(1)) {
    const value = token.value;
    if (parsingOptions && value === "--") {
      parsingOptions = false;
    } else if (parsingOptions && value.startsWith("-") && value !== "-") {
      recursiveOptionUnknown ||= /[$`*?[\]{}]/.test(value);
      recursive ||= value === "--recursive" || (/^-[^-]/.test(value) && /[rR]/.test(value.slice(1)));
    } else {
      if (parsingOptions && (value.includes("$") || value === "<dynamic-substitution>")) {
        recursiveOptionUnknown = true;
      }
      paths.push(token);
    }
  }

  if (paths.length === 0) return "allow";

  let allAllowed = true;
  for (const token of paths) {
    if (isSymbolicTempPath(token, safeVariables)) continue;

    const target = safetyPath(token, cwd);
    if (!target) {
      allAllowed = false;
      continue;
    }

    if (
      !target.descendantsOnly &&
      (target.path === resolve("/") || (policy.blockHome && target.path === resolve(homedir())))
    ) {
      return "block";
    }
    if (isAllowedLocation(target, policy)) continue;
    allAllowed = false;
  }

  if (allAllowed) return "allow";
  return (recursive || recursiveOptionUnknown) && policy.blockRecursiveOutsideAllowedLocations ? "block" : "ask";
}

function rmInvocation(segment: Segment): Token[] | undefined {
  const prefixes = new Set(["!", "{", "then", "do", "else", "elif", "time"]);
  let commandIndex = 0;
  while (
    commandIndex < segment.tokens.length &&
    (prefixes.has(segment.tokens[commandIndex].value) ||
      /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(segment.tokens[commandIndex].value))
  ) {
    commandIndex += 1;
  }

  const first = segment.tokens[commandIndex]?.value.split("/").at(-1);
  if (first === "rm") return segment.tokens.slice(commandIndex);
  const wrappers = new Set(["command", "env", "exec", "sudo", "nohup", "xargs"]);
  if (!first || !wrappers.has(first)) return undefined;

  const rmIndex = segment.tokens.findIndex(
    (token, index) => index > commandIndex && token.value.split("/").at(-1) === "rm",
  );
  if (rmIndex === -1) return undefined;
  const invocation = segment.tokens.slice(rmIndex);
  if (first === "xargs") {
    invocation.push({
      value: "<dynamic-substitution>",
      quoted: false,
      expandable: false,
      singleQuoted: false,
      escaped: false,
      start: segment.tokens[rmIndex].start,
    });
  }
  return invocation;
}

function nestedShellCommands(segment: Segment): string[] {
  const commands: string[] = [];
  for (const token of segment.tokens) {
    if (!token.expandable) continue;
    for (const match of token.value.matchAll(/\$\(([^()]*)\)/g)) commands.push(match[1]);
    for (const match of token.value.matchAll(/`([^`]*)`/g)) commands.push(match[1]);
  }

  const shells = new Set(["sh", "bash", "zsh", "dash"]);
  const wrappers = new Set(["command", "env", "exec", "sudo", "nohup"]);
  const first = segment.tokens[0]?.value.split("/").at(-1);
  const shellIndex = shells.has(first ?? "")
    ? 0
    : wrappers.has(first ?? "")
      ? segment.tokens.findIndex((token) => shells.has(token.value.split("/").at(-1) ?? ""))
      : -1;
  if (shellIndex >= 0) {
    const commandFlag = segment.tokens.findIndex(
      (token, index) => index > shellIndex && /^-[^-]*c/.test(token.value),
    );
    const payload = segment.tokens[commandFlag + 1]?.value;
    if (commandFlag >= 0 && payload !== undefined) commands.push(payload);
  }

  const evalIndex = segment.tokens.findIndex((token) => token.value === "eval");
  const evalPayload = segment.tokens[evalIndex + 1]?.value;
  if (evalIndex >= 0 && evalPayload !== undefined) commands.push(evalPayload);
  return commands;
}

function changedDirectory(segment: Segment, cwd: string | undefined, separatorBefore?: string): string | undefined {
  if (segment.tokens[0]?.value !== "cd" || segment.tokens.length !== 2) return undefined;
  if ((separatorBefore === "&&" || separatorBefore === "||") && segment.separatorAfter !== "&&") return undefined;
  if (segment.separatorAfter === "|" || segment.separatorAfter === "&" || segment.separatorAfter === ")") return undefined;
  const target = safetyPath(segment.tokens[1], cwd);
  if (!target || target.descendantsOnly || !existsSync(target.path)) return undefined;
  return target.path;
}

type CommandInspection = { blockedByRmPolicy: boolean; needsAsk: boolean };

export function inspectCommand(
  command: string,
  cwd: string | undefined,
  settings: BashPermissionGateSettings,
  askPatterns: RegExp[],
  depth = 0,
): CommandInspection {
  if (depth > 8) return { blockedByRmPolicy: false, needsAsk: true };
  const segments = parseSegments(command);
  if (!segments) {
    return {
      blockedByRmPolicy: false,
      needsAsk: askPatterns.some((pattern) => pattern.test(command)) || /\brm\b/.test(command),
    };
  }

  const askCommands = new Set(settings.askCommands ?? []);
  let blockedByRmPolicy = false;
  let needsAsk = false;
  const cwdByDepth = new Map<number, string | undefined>([[0, cwd]]);
  const separatorByDepth = new Map<number, string | undefined>();

  for (const segment of segments) {
    const first = segment.tokens[0];
    if (!first) continue;

    if (!cwdByDepth.has(segment.subshellDepth)) {
      cwdByDepth.set(segment.subshellDepth, cwdByDepth.get(Math.max(0, segment.subshellDepth - 1)));
    }
    const effectiveCwd = cwdByDepth.get(segment.subshellDepth);
    const separatorBefore = separatorByDepth.get(segment.subshellDepth);

    const rmTokens = askCommands.has("rm") ? rmInvocation(segment) : undefined;
    if (rmTokens) {
      const decision = rmDecision(rmTokens, command, effectiveCwd, settings.rmPolicy);
      if (decision === "block") blockedByRmPolicy = true;
      if (decision === "ask") needsAsk = true;
    }

    if (!rmTokens && askCommands.has(first.value)) {
      needsAsk = true;
    } else if (!rmTokens) {
      const text = segmentMatchText(segment.tokens);
      if (text.length > 0 && askPatterns.some((pattern) => pattern.test(text))) needsAsk = true;
    } else if (first.value === "sudo" && askCommands.has("sudo")) {
      needsAsk = true;
    }

    for (const nestedCommand of nestedShellCommands(segment)) {
      const nested = inspectCommand(nestedCommand, effectiveCwd, settings, askPatterns, depth + 1);
      blockedByRmPolicy ||= nested.blockedByRmPolicy;
      needsAsk ||= nested.needsAsk;
    }

    if (first.value === "cd") {
      const changed = changedDirectory(segment, effectiveCwd, separatorBefore);
      if (changed) {
        cwdByDepth.set(segment.subshellDepth, changed);
      } else if (segment.separatorAfter !== "|" && segment.separatorAfter !== "&") {
        cwdByDepth.set(segment.subshellDepth, undefined);
      }
    }
    separatorByDepth.set(segment.subshellDepth, segment.separatorAfter);
  }

  return { blockedByRmPolicy, needsAsk };
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

    const { blockedByRmPolicy, needsAsk } = inspectCommand(command, ctx.cwd, settings, askPatterns);

    if (blockedByRmPolicy) {
      return { block: true, reason: "rm blocked by permissionGate.bash.rmPolicy" };
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
