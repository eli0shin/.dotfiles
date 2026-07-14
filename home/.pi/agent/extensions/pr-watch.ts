import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type WatchedPr = {
  repo: string;
  number: number;
  url: string;
  branch: string;
  headSha: string;
  authorLogin?: string;
};

type WatchedPrState = {
  pr: WatchedPr;
  seenActivityIds: string[];
  notifiedChecksKey?: string;
};

type WatchedSha = {
  repo: string;
  sha: string;
  notifiedChecksKey?: string;
};

type WatchState = {
  version: 2;
  enabled: boolean;
  active: boolean;
  watchedPrs: WatchedPrState[];
  watchedSha?: WatchedSha;
  recentGhOutputs: string[];
  selfLogin?: string;
  lastPollAt?: number;
  lastNotifyAt?: number;
  lastError?: string;
};

type Check = {
  name?: string;
  state?: string;
  bucket?: string;
  workflow?: string;
  link?: string;
  completedAt?: string;
};

type WorkflowRun = {
  databaseId?: number;
  name?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
};

type Activity = {
  id?: string | number;
  author?: { login?: string; type?: string; is_bot?: boolean };
  user?: { login?: string; type?: string; is_bot?: boolean };
};

type ActivityKind = "issue-comment" | "review" | "review-comment";

type TrackedActivity = {
  id: string;
  authorLogin?: string;
};

type BashToolResultLike = {
  toolName: "bash";
  isError?: boolean;
  input: { command: string };
  content?: unknown[];
};

type PrPollResult = {
  messages: string[];
  remove?: boolean;
  error?: string;
};

const CUSTOM_STATE = "pr-watch-state";
const POLL_INTERVAL_MS = 60_000;
const MAX_RECENT_GH_OUTPUTS = 3;

const initialState = (): WatchState => ({
  version: 2,
  enabled: true,
  active: false,
  watchedPrs: [],
  recentGhOutputs: [],
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWatchState(value: unknown): value is WatchState {
  return isObject(value) && value.version === 2 && Array.isArray(value.watchedPrs);
}

function isBashToolResultLike(event: unknown): event is BashToolResultLike {
  if (!isObject(event) || event.toolName !== "bash" || !isObject(event.input)) return false;
  return typeof event.input.command === "string";
}

function isTextContent(value: unknown): value is { text: string } {
  return isObject(value) && typeof value.text === "string";
}

function commandUsesGh(command: string): boolean {
  return command.startsWith("gh ") || command.includes(" gh ");
}

function textContent(content: unknown[] | undefined): string {
  return (content ?? []).filter(isTextContent).map((item) => item.text).join("\n");
}

function bareActivityId(id: string): string {
  return id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
}

export function pullRequestUrlFromText(text: string): string | undefined {
  return Array.from(text.matchAll(/https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/g)).at(-1)?.[0];
}

export function shouldTrackActivity(kind: ActivityKind, activity: Activity): boolean {
  if (activity.id === undefined || activity.id === null) return false;
  return kind !== "issue-comment" || !isBotActivity(activity);
}

function isBotActivity(activity: Activity): boolean {
  const author = activity.author ?? activity.user;
  const login = author?.login ?? "";
  return author?.is_bot === true || author?.type === "Bot" || login.endsWith("[bot]");
}

export default function prWatch(pi: ExtensionAPI): void {
  let state: WatchState = initialState();
  let interval: ReturnType<typeof setInterval> | undefined;
  let polling = false;

  function hasTargets(): boolean {
    return state.watchedPrs.length > 0 || Boolean(state.watchedSha);
  }

  function save(): void {
    pi.appendEntry(CUSTOM_STATE, state);
  }

  function setStatus(ctx: ExtensionContext): void {
    if (!state.enabled || !state.active || !hasTargets()) {
      ctx.ui.setStatus("pr-watch", undefined);
      return;
    }

    if (state.watchedPrs.length > 0) {
      const numbers = state.watchedPrs.map(({ pr }) => `#${pr.number}`).join(", ");
      ctx.ui.setStatus("pr-watch", `PR watch: ${numbers}`);
      return;
    }

    if (state.watchedSha) {
      ctx.ui.setStatus("pr-watch", `SHA ${state.watchedSha.sha.slice(0, 7)} watch`);
    }
  }

  function startPolling(ctx: ExtensionContext): void {
    if (interval || !state.enabled || !state.active || !hasTargets()) return;
    interval = setInterval(() => poll(ctx), POLL_INTERVAL_MS);
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

  async function discover(ctx: ExtensionContext, reason: string, notify = true, prTarget?: string): Promise<boolean> {
    if (!state.enabled) return false;

    const repo = await execJson<{ nameWithOwner: string }>("gh", ["repo", "view", "--json", "nameWithOwner"], ctx);
    if (!repo?.nameWithOwner) return false;

    const prViewArgs = ["pr", "view"];
    if (prTarget) prViewArgs.push(prTarget);
    prViewArgs.push("--json", "number,url,headRefName,headRefOid,state,author");
    const pr = await execJson<{
      number: number;
      url: string;
      headRefName: string;
      headRefOid: string;
      state: string;
      author?: { login?: string };
    }>("gh", prViewArgs, ctx);

    if (!pr && prTarget) {
      state.active = hasTargets();
      state.lastError = `Could not resolve PR ${prTarget}`;
      save();
      setStatus(ctx);
      return false;
    }

    if (pr?.state === "OPEN") {
      await refreshSelfLogin(ctx);

      const watchedPr: WatchedPr = {
        repo: repo.nameWithOwner,
        number: pr.number,
        url: pr.url,
        branch: pr.headRefName,
        headSha: pr.headRefOid,
        authorLogin: pr.author?.login,
      };
      const existing = state.watchedPrs.find((candidate) => candidate.pr.number === pr.number);
      if (existing) {
        existing.pr = watchedPr;
      } else {
        const added: WatchedPrState = { pr: watchedPr, seenActivityIds: [] };
        state.watchedPrs.push(added);
        await baselinePrState(added, ctx);
      }

      state.watchedSha = undefined;
      state.active = true;
      state.lastError = undefined;
      save();
      startPolling(ctx);
      setStatus(ctx);
      if (notify) ctx.ui.notify(`PR watch added #${pr.number} (${reason}).`, "info");
      return true;
    }

    if (prTarget) {
      const number = pr?.number;
      if (number !== undefined) removePr(number);
      state.active = hasTargets();
      save();
      setStatus(ctx);
      if (notify && pr) ctx.ui.notify(`PR #${pr.number} is not open; it was not added to PR watch.`, "info");
      return false;
    }

    const sha = await currentSha();
    if (!sha) return false;

    await refreshSelfLogin(ctx);

    state.active = true;
    state.watchedSha = { repo: repo.nameWithOwner, sha };
    await baselineCurrentShaState(ctx);

    state.lastError = undefined;
    save();
    startPolling(ctx);
    if (notify) ctx.ui.notify(`PR watch active for SHA ${sha.slice(0, 7)} (${reason}).`, "info");
    return true;
  }

  function removePr(number: number): void {
    state.watchedPrs = state.watchedPrs.filter((candidate) => candidate.pr.number !== number);
  }

  async function currentSha(): Promise<string | undefined> {
    const result = await pi.exec("git", ["rev-parse", "HEAD"], { timeout: 30_000 });
    const sha = result.stdout.trim();
    if (result.code !== 0 || !sha) return undefined;
    return sha;
  }

  async function refreshSelfLogin(ctx: ExtensionContext): Promise<void> {
    const user = await execJson<{ login?: string }>("gh", ["api", "user"], ctx);
    state.selfLogin = user?.login || undefined;
  }

  async function fetchChecks(watched: WatchedPrState, ctx: ExtensionContext): Promise<Check[]> {
    const checks = await execJson<Check[]>("gh", [
      "pr",
      "checks",
      watched.pr.url,
      "--json",
      "name,state,bucket,workflow,link,completedAt",
    ], ctx);
    return checks ?? [];
  }

  async function fetchRunsForSha(ctx: ExtensionContext): Promise<WorkflowRun[]> {
    if (!state.watchedSha) return [];
    const runs = await execJson<WorkflowRun[]>("gh", [
      "run",
      "list",
      "--commit",
      state.watchedSha.sha,
      "--json",
      "databaseId,name,workflowName,status,conclusion,url,createdAt,updatedAt",
    ], ctx);
    return runs ?? [];
  }

  function isApprovalWaitingCheck(check: Check): boolean {
    const completedAt = check.completedAt ?? "";
    return (
      (check.state ?? "").toLowerCase() === "waiting" &&
      (check.bucket ?? "").toLowerCase() === "pending" &&
      completedAt.startsWith("0001-01-01") &&
      (check.link ?? "").includes("/actions/runs/") &&
      Boolean(check.workflow)
    );
  }

  function isTerminalCheck(check: Check): boolean {
    const stateValue = (check.state ?? "").toLowerCase();
    const bucketValue = (check.bucket ?? "").toLowerCase();

    // GitHub Actions deployment jobs paused for environment approval show up as
    // WAITING/pending with no completion timestamp. Some repos approve these only
    // after merge, so don't let them keep PR-watch pending forever.
    if (isApprovalWaitingCheck(check)) return true;

    return Boolean(stateValue || bucketValue) && ![stateValue, bucketValue].some((value) =>
      ["pending", "queued", "in_progress", "requested", "waiting"].includes(value),
    );
  }

  function checksCompletionKey(headSha: string, checks: Check[]): string {
    const checkSignature = checks
      .map((check) => [check.workflow, check.name, check.state, check.bucket, check.completedAt, check.link].join("|"))
      .sort()
      .join(";");
    return `${headSha}:${checkSignature}`;
  }

  function isTerminalRun(run: WorkflowRun): boolean {
    return (run.status ?? "").toLowerCase() === "completed";
  }

  function runsCompletionKey(sha: string, runs: WorkflowRun[]): string {
    const runSignature = runs
      .map((run) => [run.databaseId, run.workflowName, run.name, run.status, run.conclusion, run.url].join("|"))
      .sort()
      .join(";");
    return `${sha}:${runSignature}`;
  }

  async function baselinePrState(watched: WatchedPrState, ctx: ExtensionContext): Promise<void> {
    const checks = await fetchChecks(watched, ctx);
    watched.notifiedChecksKey =
      checks.length > 0 && checks.every(isTerminalCheck)
        ? checksCompletionKey(watched.pr.headSha, checks)
        : undefined;
    watched.seenActivityIds = (await fetchActivities(watched, ctx)).map((activity) => activity.id);
  }

  async function baselineCurrentShaState(ctx: ExtensionContext): Promise<void> {
    if (!state.watchedSha) return;
    const runs = await fetchRunsForSha(ctx);
    state.watchedSha.notifiedChecksKey =
      runs.length > 0 && runs.every(isTerminalRun)
        ? runsCompletionKey(state.watchedSha.sha, runs)
        : undefined;
  }

  async function fetchActivities(watched: WatchedPrState, ctx: ExtensionContext): Promise<TrackedActivity[]> {
    const { repo, number } = watched.pr;
    const [issueComments, reviews, reviewComments] = await Promise.all([
      execJson<Activity[]>("gh", ["api", `repos/${repo}/issues/${number}/comments?per_page=100`], ctx),
      execJson<Activity[]>("gh", ["api", `repos/${repo}/pulls/${number}/reviews?per_page=100`], ctx),
      execJson<Activity[]>("gh", ["api", `repos/${repo}/pulls/${number}/comments?per_page=100`], ctx),
    ]);

    return [
      ...trackActivities("issue-comment", issueComments),
      ...trackActivities("review", reviews),
      ...trackActivities("review-comment", reviewComments),
    ];
  }

  function trackActivities(kind: ActivityKind, activities: Activity[] | undefined): TrackedActivity[] {
    return (activities ?? [])
      .filter((activity) => shouldTrackActivity(kind, activity))
      .map((activity) => ({
        id: `${kind}:${activity.id}`,
        authorLogin: activityAuthorLogin(activity),
      }));
  }

  function activityAuthorLogin(activity: Activity): string | undefined {
    return (activity.author ?? activity.user)?.login;
  }

  function isSuppressedSelfActivity(activity: TrackedActivity): boolean {
    if (!state.selfLogin || activity.authorLogin !== state.selfLogin) return false;
    const bareId = bareActivityId(activity.id);
    return Boolean(bareId) && state.recentGhOutputs.some((output) => output.includes(bareId));
  }

  function formatActivityList(activities: TrackedActivity[]): string {
    return activities.map((activity) => `- ${activity.id} by ${activity.authorLogin ?? "unknown"}`).join("\n");
  }

  function prWatchMode(watched: WatchedPrState): "author" | "reviewer" | "unknown" {
    if (!watched.pr.authorLogin || !state.selfLogin) return "unknown";
    return watched.pr.authorLogin === state.selfLogin ? "author" : "reviewer";
  }

  function reviewerSafetyNotice(watched: WatchedPrState): string {
    const authorLogin = watched.pr.authorLogin;
    if (prWatchMode(watched) === "reviewer") {
      return `This PR is authored by ${authorLogin}, not you. Do not edit files, commit, or push unless the user explicitly asks you to take over implementation. Do not post comments or reviews, approve/request changes, merge/close/reopen, or otherwise mutate the PR unless the user explicitly asks for that specific action.`;
    }

    return "I could not determine whether this PR is authored by you. Do not edit files, commit, or push unless the user explicitly asks you to take over implementation. Do not post comments or reviews, approve/request changes, merge/close/reopen, or otherwise mutate the PR unless the user explicitly asks for that specific action.";
  }

  function prIdentity(watched: WatchedPrState): string {
    return `branch ${watched.pr.branch} (PR #${watched.pr.number})`;
  }

  function buildPrChecksMessage(watched: WatchedPrState): string {
    const identity = prIdentity(watched);
    const details = `Branch: ${watched.pr.branch}\nPR: ${watched.pr.url}\nHead SHA: ${watched.pr.headSha}`;

    if (prWatchMode(watched) === "author") {
      return `CI finished for ${identity}.\n\nPlease inspect the PR checks/results with gh, determine whether anything needs to be fixed, and take appropriate action. If they failed, diagnose and fix them.\n\nA passing check is not sufficient on its own. If any check involves a generated diff (e.g. a "diff", "codegen", "inferred types", "snapshot", or "generated files" step), do not treat a green result as done: fetch and read the actual diff/output from that step (e.g. \`gh run view\`, the check's logs, or the committed generated files) and verify the generated changes match the changes you intended. Confirm there are no unintended or surprising changes (e.g. unexpected inferred-type or schema changes) before closing the loop. If the diff contains anything you did not intend, treat it as a problem to investigate and fix rather than a pass.\n\nOnce you have confirmed the checks passed AND any generated diffs are correct and intentional, briefly summarize that.\n\n${details}`;
    }

    const authorLogin = watched.pr.authorLogin ?? "unknown";
    const headline =
      prWatchMode(watched) === "reviewer"
        ? `CI finished for ${identity}, which you are reviewing.`
        : `CI finished for watched ${identity}.`;
    return `${headline}\n\n${reviewerSafetyNotice(watched)}\n\nPlease inspect the CI result as reviewer context. Summarize whether CI passed or failed, whether the result affects your review, and whether you recommend any follow-up comment.\n\n${details}\nAuthor: ${authorLogin}`;
  }

  function buildPrFeedbackMessage(watched: WatchedPrState, triggeringActivities: TrackedActivity[]): string {
    const identity = prIdentity(watched);
    const activityList = formatActivityList(triggeringActivities);
    const details = `Branch: ${watched.pr.branch}\nPR: ${watched.pr.url}`;

    if (prWatchMode(watched) === "author") {
      return `New PR feedback was added for ${identity}.\n\nTriggering activity:\n${activityList}\n\nPlease inspect these specific new feedback items first, then check any related unresolved review threads if needed. Summarize the actionable feedback and address it. If something is ambiguous but a reasonable low-risk interpretation exists, make that change and explain your assumption. Only stop for user input if proceeding could invalidate the existing design or cause broad rework.\n\n${details}`;
    }

    const authorLogin = watched.pr.authorLogin ?? "unknown";
    const headline =
      prWatchMode(watched) === "reviewer"
        ? `New activity was added for ${identity}, which you are reviewing.`
        : `New activity was added for watched ${identity}.`;
    return `${headline}\n\n${reviewerSafetyNotice(watched)}\n\nTriggering activity:\n${activityList}\n\nPlease inspect these specific items as reviewer context. Summarize what changed and whether it affects your review. If a reply or follow-up review comment would be useful, say what you would write; do not assume you should modify the PR.\n\n${details}\nAuthor: ${authorLogin}`;
  }

  function buildBatchMessage(messages: string[]): string {
    if (messages.length === 1) return messages[0] ?? "";
    return `PR watch detected multiple updates.\n\n${messages
      .map((message, index) => `## Update ${index + 1}\n\n${message}`)
      .join("\n\n---\n\n")}`;
  }

  async function notifyAgent(ctx: ExtensionContext, message: string): Promise<void> {
    if (ctx.isIdle()) pi.sendUserMessage(message);
    else pi.sendUserMessage(message, { deliverAs: "followUp" });
  }

  async function pollPr(watched: WatchedPrState, ctx: ExtensionContext): Promise<PrPollResult> {
    const latest = await execJson<{
      headRefOid: string;
      headRefName?: string;
      state: string;
      author?: { login?: string };
    }>("gh", ["pr", "view", watched.pr.url, "--json", "headRefOid,headRefName,state,author"], ctx);

    if (!latest) return { messages: [], error: `Could not refresh watched PR ${watched.pr.url}` };
    if (latest.state !== "OPEN") return { messages: [], remove: true };

    if (latest.author?.login) watched.pr.authorLogin = latest.author.login;
    if (latest.headRefName) watched.pr.branch = latest.headRefName;
    if (latest.headRefOid !== watched.pr.headSha) {
      watched.pr.headSha = latest.headRefOid;
      watched.notifiedChecksKey = undefined;
    }

    const messages: string[] = [];
    const checks = await fetchChecks(watched, ctx);
    const allChecksTerminal = checks.length > 0 && checks.every(isTerminalCheck);
    const checksKey = checksCompletionKey(watched.pr.headSha, checks);
    if (allChecksTerminal && watched.notifiedChecksKey !== checksKey) {
      watched.notifiedChecksKey = checksKey;
      messages.push(buildPrChecksMessage(watched));
    }

    const currentActivities = await fetchActivities(watched, ctx);
    const currentActivityIds = currentActivities.map((activity) => activity.id);
    const seen = new Set(watched.seenActivityIds);
    const newActivities = currentActivities.filter((activity) => !seen.has(activity.id));
    const triggeringActivities = newActivities.filter((activity) => !isSuppressedSelfActivity(activity));
    if (triggeringActivities.length > 0) messages.push(buildPrFeedbackMessage(watched, triggeringActivities));

    watched.seenActivityIds = Array.from(new Set([...watched.seenActivityIds, ...currentActivityIds]));
    return { messages };
  }

  async function poll(ctx: ExtensionContext): Promise<void> {
    if (polling || !state.enabled || !state.active || !hasTargets()) return;
    polling = true;

    try {
      await refreshSelfLogin(ctx);
      const messages: string[] = [];
      const errors: string[] = [];

      for (const watched of [...state.watchedPrs]) {
        try {
          const result = await pollPr(watched, ctx);
          messages.push(...result.messages);
          if (result.error) errors.push(result.error);
          if (result.remove) removePr(watched.pr.number);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      const shaMessage = await pollSha(ctx);
      if (shaMessage) messages.push(shaMessage);

      if (messages.length > 0) {
        state.lastNotifyAt = Date.now();
        await notifyAgent(ctx, buildBatchMessage(messages));
      }

      state.active = hasTargets();
      state.lastPollAt = Date.now();
      state.lastError = errors.length > 0 ? errors.join("; ") : undefined;
      if (!state.active) stopPolling(ctx);
      save();
      setStatus(ctx);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      save();
    } finally {
      polling = false;
    }
  }

  async function pollSha(ctx: ExtensionContext): Promise<string | undefined> {
    if (!state.watchedSha) return undefined;

    const runs = await fetchRunsForSha(ctx);
    const allRunsTerminal = runs.length > 0 && runs.every(isTerminalRun);
    const runsKey = runsCompletionKey(state.watchedSha.sha, runs);
    if (!allRunsTerminal || state.watchedSha.notifiedChecksKey === runsKey) return undefined;

    state.watchedSha.notifiedChecksKey = runsKey;
    return `CI finished for SHA ${state.watchedSha.sha.slice(0, 7)}.\n\nPlease inspect the workflow runs/results with gh, determine whether anything needs to be fixed, and take appropriate action. If they failed, diagnose and fix them.\n\nA passing run is not sufficient on its own. If any run involves a generated diff (e.g. a "diff", "codegen", "inferred types", "snapshot", or "generated files" step), do not treat a green result as done: fetch and read the actual diff/output from that step (e.g. \`gh run view\`, the run logs, or the committed generated files) and verify the generated changes match the changes you intended. Confirm there are no unintended or surprising changes (e.g. unexpected inferred-type or schema changes) before closing the loop. If the diff contains anything you did not intend, treat it as a problem to investigate and fix rather than a pass.\n\nOnce you have confirmed the runs passed AND any generated diffs are correct and intentional, briefly summarize that.\n\nRepo: ${state.watchedSha.repo}\nSHA: ${state.watchedSha.sha}`;
  }

  function recordRecentGhOutput(output: string): void {
    state.recentGhOutputs = [...state.recentGhOutputs, output].slice(-MAX_RECENT_GH_OUTPUTS);
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
      if (entry.type === "custom" && entry.customType === CUSTOM_STATE && isWatchState(entry.data)) {
        state = { ...entry.data, watchedPrs: structuredClone(entry.data.watchedPrs) };
      }
    }
    state.recentGhOutputs ??= [];

    if (!state.enabled || !state.active || !hasTargets()) return;

    const savedPrs = [...state.watchedPrs];
    const savedSha = state.watchedSha;
    state.watchedPrs = [];
    state.watchedSha = undefined;
    for (const watched of savedPrs) await discover(ctx, "startup", false, watched.pr.url);

    if (state.watchedPrs.length === 0 && savedSha) {
      state.watchedSha = { repo: savedSha.repo, sha: savedSha.sha };
      await baselineCurrentShaState(ctx);
      state.active = true;
      save();
      startPolling(ctx);
    }

    state.active = hasTargets();
    save();
    setStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!state.enabled || !isBashToolResultLike(event) || event.isError) return;
    const command = event.input.command;
    if (!command) return;

    const output = textContent(event.content);
    if (commandUsesGh(command)) {
      recordRecentGhOutput(output);
      save();
    }

    if (isActivationCommand(command)) {
      await discover(ctx, "gh pr command", true, pullRequestUrlFromText(output));
      return;
    }

    if (isGitPush(command)) await discover(ctx, "git push", false);
  });

  pi.registerCommand("pr-watch", {
    description: "Watch PRs for CI completion and relevant feedback",
    handler: async (args, ctx) => {
      const [rawAction = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const action = rawAction.toLowerCase();
      const target = rest.join(" ");

      if (action === "on") {
        state.enabled = true;
        state.active = true;
        save();
        const found = await discover(ctx, "manual on");
        if (!found && !hasTargets()) {
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

      if (action === "add") {
        if (!target) {
          ctx.ui.notify("Usage: /pr-watch add <number-or-url>", "warning");
          return;
        }
        state.enabled = true;
        state.active = true;
        save();
        await discover(ctx, "manual add", true, target);
        return;
      }

      if (action === "remove") {
        const number = Number(target.match(/\d+$/)?.[0]);
        if (!Number.isInteger(number) || number <= 0) {
          ctx.ui.notify("Usage: /pr-watch remove <number-or-url>", "warning");
          return;
        }
        const existed = state.watchedPrs.some((watched) => watched.pr.number === number);
        removePr(number);
        state.active = hasTargets();
        if (!state.active) stopPolling(ctx);
        save();
        setStatus(ctx);
        ctx.ui.notify(existed ? `Removed PR #${number} from PR watch.` : `PR #${number} was not being watched.`, "info");
        return;
      }

      if (action === "reset") {
        state = { ...initialState(), enabled: state.enabled, active: true };
        save();
        await discover(ctx, "manual reset");
        return;
      }

      if (action !== "status") {
        ctx.ui.notify("Usage: /pr-watch [status|on|off|add <number-or-url>|remove <number-or-url>|reset]", "warning");
        return;
      }

      const watchedPrs =
        state.watchedPrs.length > 0
          ? state.watchedPrs
              .map(
                ({ pr, seenActivityIds }) =>
                  `PR #${pr.number} ${pr.url}\n  branch: ${pr.branch}\n  head: ${pr.headSha}\n  author: ${pr.authorLogin ?? "unknown"}\n  watch mode: ${prWatchMode({ pr, seenActivityIds })}\n  seen activity: ${seenActivityIds.length}`,
              )
              .join("\n")
          : "none";
      const watchedSha = state.watchedSha
        ? `SHA ${state.watchedSha.sha}\nrepo: ${state.watchedSha.repo}`
        : "none";
      const lines = [
        `PR watch: ${state.enabled ? "enabled" : "disabled"}`,
        `mode: ${state.active && hasTargets() ? "active" : "dormant"}`,
        `watched PRs:\n${watchedPrs}`,
        `watched SHA: ${watchedSha}`,
        `recent gh outputs: ${state.recentGhOutputs.length}`,
        `self login: ${state.selfLogin ?? "unknown"}`,
        `last poll: ${state.lastPollAt ? new Date(state.lastPollAt).toLocaleString() : "never"}`,
        `last notify: ${state.lastNotifyAt ? new Date(state.lastNotifyAt).toLocaleString() : "never"}`,
      ];
      if (state.lastError) lines.push(`last error: ${state.lastError}`);
      ctx.ui.notify(lines.join("\n"), state.lastError ? "warning" : "info");
    },
  });
}
