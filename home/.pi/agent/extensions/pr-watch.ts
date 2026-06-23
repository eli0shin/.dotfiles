import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type WatchedPr = {
  repo: string;
  number: number;
  url: string;
  branch: string;
  headSha: string;
};

type WatchState = {
  enabled: boolean;
  active: boolean;
  watchedPr?: WatchedPr;
  seenActivityIds: string[];
  checkHeadSha?: string;
  checksHadPending: boolean;
  notifiedChecksKey?: string;
  lastPollAt?: number;
  lastNotifyAt?: number;
  lastError?: string;
};

type Check = {
  name?: string;
  state?: string;
  conclusion?: string;
  link?: string;
  completedAt?: string;
};

type Activity = {
  id: string;
  author?: { login?: string; type?: string; is_bot?: boolean };
  user?: { login?: string; type?: string; is_bot?: boolean };
};

type BashToolResultLike = {
  toolName: "bash";
  isError?: boolean;
  input: { command: string };
};

const CUSTOM_STATE = "pr-watch-state";
const POLL_INTERVAL_MS = 60_000;

const initialState = (): WatchState => ({
  enabled: true,
  active: false,
  seenActivityIds: [],
  checksHadPending: false,
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBashToolResultLike(event: unknown): event is BashToolResultLike {
  if (!isObject(event) || event.toolName !== "bash" || !isObject(event.input)) return false;
  return typeof event.input.command === "string";
}

export default function prWatch(pi: ExtensionAPI): void {
  let state: WatchState = initialState();
  let interval: ReturnType<typeof setInterval> | undefined;
  let polling = false;

  function save(): void {
    pi.appendEntry(CUSTOM_STATE, state);
  }

  function setStatus(ctx: ExtensionContext): void {
    if (!state.enabled) {
      ctx.ui.setStatus("pr-watch", undefined);
      return;
    }

    if (state.active && state.watchedPr) {
      ctx.ui.setStatus("pr-watch", `PR #${state.watchedPr.number} watch`);
      return;
    }

    ctx.ui.setStatus("pr-watch", undefined);
  }

  function startPolling(ctx: ExtensionContext): void {
    if (interval || !state.enabled || !state.active || !state.watchedPr) return;
    interval = setInterval(() => void poll(ctx, "interval"), POLL_INTERVAL_MS);
    setStatus(ctx);
  }

  function stopPolling(ctx?: ExtensionContext): void {
    if (interval) clearInterval(interval);
    interval = undefined;
    if (ctx) setStatus(ctx);
  }

  async function execJson<T>(command: string, args: string[], ctx: ExtensionContext): Promise<T | undefined> {
    const result = await pi.exec(command, args, { timeout: 30_000 });
    if (!result.stdout.trim()) return undefined;
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      if (result.code === 0) ctx.ui.notify(`pr-watch could not parse ${command} output`, "warning");
      return undefined;
    }
  }

  async function discover(ctx: ExtensionContext, reason: string, notify = true): Promise<boolean> {
    if (!state.enabled) return false;

    const pr = await execJson<{
      number: number;
      url: string;
      headRefName: string;
      headRefOid: string;
      state: string;
    }>("gh", ["pr", "view", "--json", "number,url,headRefName,headRefOid,state"], ctx);

    if (!pr || pr.state !== "OPEN") {
      state.active = false;
      state.watchedPr = undefined;
      stopPolling(ctx);
      save();
      if (notify) ctx.ui.notify("PR watch is armed; no open PR found for this branch.", "info");
      return false;
    }

    const repo = await execJson<{ nameWithOwner: string }>("gh", ["repo", "view", "--json", "nameWithOwner"], ctx);
    if (!repo?.nameWithOwner) return false;

    const previousKey = state.watchedPr ? `${state.watchedPr.repo}#${state.watchedPr.number}` : undefined;
    const nextKey = `${repo.nameWithOwner}#${pr.number}`;
    const headChanged = state.watchedPr?.headSha !== pr.headRefOid;

    state.active = true;
    state.watchedPr = {
      repo: repo.nameWithOwner,
      number: pr.number,
      url: pr.url,
      branch: pr.headRefName,
      headSha: pr.headRefOid,
    };

    if (previousKey !== nextKey || headChanged) {
      state.checkHeadSha = pr.headRefOid;
      state.checksHadPending = false;
      state.notifiedChecksKey = undefined;
      state.seenActivityIds = await fetchActivityIds(ctx);
    }

    state.lastError = undefined;
    save();
    startPolling(ctx);
    if (notify) ctx.ui.notify(`PR watch active for #${pr.number} (${reason}).`, "info");
    await poll(ctx, "discover", { suppressInitialNotifications: true });
    return true;
  }

  async function fetchChecks(ctx: ExtensionContext): Promise<Check[]> {
    const checks = await execJson<Check[]>("gh", [
      "pr",
      "checks",
      "--json",
      "name,state,conclusion,link,completedAt",
    ], ctx);
    return checks ?? [];
  }

  function isTerminalCheck(check: Check): boolean {
    if (check.conclusion) return true;
    const stateValue = (check.state ?? "").toLowerCase();
    return Boolean(stateValue) && !["pending", "queued", "in_progress", "requested", "waiting"].includes(stateValue);
  }

  async function fetchActivityIds(ctx: ExtensionContext): Promise<string[]> {
    if (!state.watchedPr) return [];
    const { repo, number } = state.watchedPr;
    const [issueComments, reviews, reviewComments] = await Promise.all([
      execJson<Activity[]>("gh", ["api", `repos/${repo}/issues/${number}/comments?per_page=100`], ctx),
      execJson<Activity[]>("gh", ["api", `repos/${repo}/pulls/${number}/reviews?per_page=100`], ctx),
      execJson<Activity[]>("gh", ["api", `repos/${repo}/pulls/${number}/comments?per_page=100`], ctx),
    ]);

    return [
      ...(issueComments ?? []).map((item) => ({ ...item, id: `issue-comment:${item.id}` })),
      ...(reviews ?? []).map((item) => ({ ...item, id: `review:${item.id}` })),
      ...(reviewComments ?? []).map((item) => ({ ...item, id: `review-comment:${item.id}` })),
    ]
      .filter((item) => item.id && !isBotActivity(item))
      .map((item) => item.id);
  }

  function isBotActivity(activity: Activity): boolean {
    const author = activity.author ?? activity.user;
    const login = author?.login ?? "";
    return author?.is_bot === true || author?.type === "Bot" || login.endsWith("[bot]");
  }

  async function notifyAgent(ctx: ExtensionContext, message: string): Promise<void> {
    if (ctx.isIdle()) pi.sendUserMessage(message);
    else pi.sendUserMessage(message, { deliverAs: "followUp" });
  }

  async function poll(ctx: ExtensionContext, reason: string, options: { suppressInitialNotifications?: boolean } = {}): Promise<void> {
    if (polling || !state.enabled || !state.active || !state.watchedPr) return;
    polling = true;

    try {
      const latest = await execJson<{
        headRefOid: string;
        state: string;
      }>("gh", ["pr", "view", String(state.watchedPr.number), "--json", "headRefOid,state"], ctx);

      if (!latest || latest.state !== "OPEN") {
        state.active = false;
        stopPolling(ctx);
        save();
        return;
      }

      if (latest.headRefOid !== state.watchedPr.headSha) {
        state.watchedPr.headSha = latest.headRefOid;
        state.checkHeadSha = latest.headRefOid;
        state.checksHadPending = false;
        state.notifiedChecksKey = undefined;
      }

      const checks = await fetchChecks(ctx);
      const allChecksTerminal = checks.length > 0 && checks.every(isTerminalCheck);
      const checksPending = checks.length > 0 && !allChecksTerminal;
      const checksKey = `${state.watchedPr.headSha}:complete`;

      if (checksPending) {
        state.checksHadPending = true;
      } else if (
        allChecksTerminal &&
        state.checksHadPending &&
        state.notifiedChecksKey !== checksKey &&
        !options.suppressInitialNotifications
      ) {
        state.notifiedChecksKey = checksKey;
        state.lastNotifyAt = Date.now();
        await notifyAgent(
          ctx,
          `CI finished for the current PR.\n\nPlease inspect the PR checks/results with gh, determine whether anything needs to be fixed, and take appropriate action. If the checks passed, briefly summarize that. If they failed, diagnose and fix them.\n\nPR: ${state.watchedPr.url}\nHead SHA: ${state.watchedPr.headSha}`,
        );
      }

      const currentActivityIds = await fetchActivityIds(ctx);
      const seen = new Set(state.seenActivityIds);
      const newActivityIds = currentActivityIds.filter((id) => !seen.has(id));

      if (newActivityIds.length > 0 && !options.suppressInitialNotifications) {
        state.lastNotifyAt = Date.now();
        await notifyAgent(
          ctx,
          `New human PR feedback was added to the current PR.\n\nPlease inspect the latest PR comments, reviews, and review threads with gh, summarize the actionable feedback, and address it. If something is ambiguous but a reasonable low-risk interpretation exists, make that change and explain your assumption. Only stop for user input if proceeding could invalidate the existing design or cause broad rework.\n\nPR: ${state.watchedPr.url}`,
        );
      }

      state.seenActivityIds = Array.from(new Set([...state.seenActivityIds, ...currentActivityIds]));
      state.lastPollAt = Date.now();
      state.lastError = undefined;
      save();
      setStatus(ctx);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      save();
    } finally {
      polling = false;
    }
  }

  function isActivationCommand(command: string): boolean {
    return /(^|[;&|\n]\s*)gh\s+pr\s+(create|view|ready|edit|checkout)\b/.test(command);
  }

  function isGitPush(command: string): boolean {
    return /(^|[;&|\n]\s*)git\s+push\b/.test(command);
  }

  pi.on("session_start", async (_event, ctx) => {
    state = initialState();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === CUSTOM_STATE && entry.data) {
        state = { ...initialState(), ...(entry.data as WatchState) };
      }
    }

    if (state.enabled && state.active && state.watchedPr) {
      startPolling(ctx);
      void poll(ctx, "startup", { suppressInitialNotifications: true });
    }
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!state.enabled || !isBashToolResultLike(event) || event.isError) return;
    const command = event.input.command;
    if (!command) return;

    if (isActivationCommand(command)) {
      await discover(ctx, "gh pr command");
      return;
    }

    if (isGitPush(command)) {
      await discover(ctx, "git push", false);
    }
  });

  pi.registerCommand("pr-watch", {
    description: "Watch the current branch PR for CI completion and new human feedback",
    handler: async (args, ctx) => {
      const action = (args.trim().split(/\s+/)[0] || "status").toLowerCase();

      if (action === "on") {
        state.enabled = true;
        state.active = true;
        save();
        const found = await discover(ctx, "manual on");
        if (!found) {
          state.active = false;
          save();
        }
        return;
      }

      if (action === "off") {
        state.enabled = false;
        state.active = false;
        stopPolling(ctx);
        save();
        ctx.ui.notify("PR watch disabled for this session.", "info");
        return;
      }

      if (action === "reset") {
        state = { ...initialState(), enabled: state.enabled, active: true };
        save();
        await discover(ctx, "manual reset");
        return;
      }

      if (action !== "status") {
        ctx.ui.notify("Usage: /pr-watch [status|on|off|reset]", "warning");
        return;
      }

      const watched = state.watchedPr
        ? `#${state.watchedPr.number} ${state.watchedPr.url}\nbranch: ${state.watchedPr.branch}\nhead: ${state.watchedPr.headSha}`
        : "none";
      const lines = [
        `PR watch: ${state.enabled ? "enabled" : "disabled"}`,
        `mode: ${state.active && state.watchedPr ? "active" : "dormant"}`,
        `watched PR: ${watched}`,
        `seen human activity: ${state.seenActivityIds.length}`,
        `last poll: ${state.lastPollAt ? new Date(state.lastPollAt).toLocaleString() : "never"}`,
        `last notify: ${state.lastNotifyAt ? new Date(state.lastNotifyAt).toLocaleString() : "never"}`,
      ];
      if (state.lastError) lines.push(`last error: ${state.lastError}`);
      ctx.ui.notify(lines.join("\n"), state.lastError ? "warning" : "info");
    },
  });
}
