import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  atomicWriteJson,
  commandResponsePath,
  registrationPath,
  sessionStatePath,
  stateRoot,
  statusPath,
  type CommandResponse,
  type Registration,
  type StatusSnapshot,
} from "./pr-watch-ipc.ts";

export type WatchedPr = {
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
  mergeable?: string;
  baselinePending?: boolean;
};

type WatchedSha = { repo: string; sha: string; notifiedChecksKey?: string; baselinePending?: boolean };
type WatchMode = "active" | "paused" | "off";
type TrackedActivity = { id: string; authorLogin?: string };
type PendingPrUpdate = {
  pr: WatchedPr;
  checksHeadSha?: string;
  checksKey?: string;
  conflictsKey?: string;
  feedbackActivities: TrackedActivity[];
};
type PendingShaUpdate = { repo: string; sha: string; runsKey: string };
type WorkerWatchSnapshot = {
  version: 1;
  orchestrationId: string;
  workerSessionId: string;
  revision: number;
  watchedPrs: Array<Pick<WatchedPr, "repo" | "number" | "url">>;
};

export type WatchState = {
  version: 1;
  mode: WatchMode;
  watchedPrs: WatchedPrState[];
  watchedSha?: WatchedSha;
  pendingPrUpdates: PendingPrUpdate[];
  pendingShaUpdate?: PendingShaUpdate;
  recentGhOutputs: string[];
  orchestrationSessionId?: string;
  workerSnapshots?: Record<string, WorkerWatchSnapshot>;
  resolvedOrchestrationPrUrls?: string[];
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
  attempt?: number;
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
type Notify = (message: string, variant?: "info" | "warning" | "error") => void;
type Wake = (message: string) => Promise<void>;

type ControllerOptions = {
  sessionID: string;
  directory: string;
  root?: string;
  notify?: Notify;
  wake: Wake;
};

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 60_000;
const MAX_RECENT_GH_OUTPUTS = 3;

function initialState(): WatchState {
  return { version: 1, mode: "active", watchedPrs: [], pendingPrUpdates: [], recentGhOutputs: [] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWatchState(value: unknown): value is WatchState {
  return (
    isObject(value) &&
    value.version === 1 &&
    ["active", "paused", "off"].includes(String(value.mode)) &&
    Array.isArray(value.watchedPrs) &&
    Array.isArray(value.pendingPrUpdates) &&
    Array.isArray(value.recentGhOutputs)
  );
}

function isWorkerWatchSnapshot(value: unknown): value is WorkerWatchSnapshot {
  return (
    isObject(value) &&
    value.version === 1 &&
    typeof value.orchestrationId === "string" &&
    typeof value.workerSessionId === "string" &&
    typeof value.revision === "number" &&
    Array.isArray(value.watchedPrs) &&
    value.watchedPrs.every(
      (pr) =>
        isObject(pr) &&
        typeof pr.repo === "string" &&
        typeof pr.number === "number" &&
        typeof pr.url === "string",
    )
  );
}

export function prIdentityKey(pr: Pick<WatchedPr, "repo" | "number">): string {
  return `${pr.repo.toLowerCase()}#${pr.number}`;
}

export function pullRequestUrlFromText(text: string): string | undefined {
  return Array.from(text.matchAll(/https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/g)).at(-1)?.[0];
}

function isBotActivity(activity: Activity): boolean {
  const author = activity.author ?? activity.user;
  const login = author?.login ?? "";
  return author?.is_bot === true || author?.type === "Bot" || login.endsWith("[bot]");
}

export function shouldTrackActivity(kind: ActivityKind, activity: Activity): boolean {
  if (activity.id === undefined || activity.id === null) return false;
  return kind !== "issue-comment" || !isBotActivity(activity);
}

function activityAuthor(activity: Activity): string | undefined {
  return (activity.author ?? activity.user)?.login;
}

function bareActivityId(id: string): string {
  return id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
}

function commandUsesGh(command: string): boolean {
  return command.startsWith("gh ") || command.includes(" gh ");
}

function isActivationCommand(command: string): boolean {
  return /(^|[;&|\n]\s*)gh\s+pr\s+(create|view|ready|edit|checkout)\b/.test(command);
}

function isGitPush(command: string): boolean {
  return /(^|[;&|\n]\s*)git\s+push\b/.test(command);
}

function prCoordinatesFromUrl(url: string): { repo: string; number: number } | undefined {
  try {
    const [owner, repo, kind, rawNumber] = new URL(url).pathname.split("/").filter(Boolean);
    const number = Number(rawNumber);
    return owner && repo && kind === "pull" && Number.isInteger(number) && number > 0
      ? { repo: `${owner}/${repo}`, number }
      : undefined;
  } catch {
    return undefined;
  }
}

function repositoryFromPrUrl(url: string): string | undefined {
  return prCoordinatesFromUrl(url)?.repo;
}

function checksCompletionKey(headSha: string, checks: Check[]): string {
  return JSON.stringify([
    headSha,
    ...checks
      .map((check) => [check.name, check.workflow, check.state, check.bucket, check.completedAt, check.link])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ]);
}

function runsCompletionKey(sha: string, runs: WorkflowRun[]): string {
  return JSON.stringify([
    sha,
    ...runs
      .map((run) => [run.databaseId, run.attempt, run.status, run.conclusion, run.updatedAt, run.url])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ]);
}

function isApprovalWaitingCheck(check: Check): boolean {
  const completedAt = check.completedAt ?? "";
  return (
    (check.state ?? "").toLowerCase() === "waiting" &&
    completedAt.startsWith("0001-01-01") &&
    (check.link ?? "").includes("/actions/runs/") &&
    Boolean(check.workflow)
  );
}

function isTerminalCheck(check: Check): boolean {
  if (isApprovalWaitingCheck(check)) return true;
  const values = [check.state, check.bucket].filter(Boolean).map((value) => String(value).toLowerCase());
  return values.length > 0 && !values.some((value) => ["pending", "queued", "in_progress", "requested", "waiting"].includes(value));
}

function isFailingCheck(check: Check): boolean {
  return [check.state, check.bucket]
    .filter(Boolean)
    .some((value) => ["fail", "failure", "cancel", "cancelled", "timed_out", "action_required", "startup_failure"].includes(String(value).toLowerCase()));
}

function isTerminalRun(run: WorkflowRun): boolean {
  return String(run.status ?? "").toLowerCase() === "completed";
}

function removeEmptyPendingPr(state: WatchState, pr: WatchedPr): void {
  state.pendingPrUpdates = state.pendingPrUpdates.filter(
    (pending) =>
      prIdentityKey(pending.pr) !== prIdentityKey(pr) ||
      Boolean(pending.checksKey || pending.conflictsKey || pending.feedbackActivities.length),
  );
}

function pendingFor(state: WatchState, pr: WatchedPr): PendingPrUpdate {
  let pending = state.pendingPrUpdates.find((item) => prIdentityKey(item.pr) === prIdentityKey(pr));
  if (!pending) {
    pending = { pr: structuredClone(pr), feedbackActivities: [] };
    state.pendingPrUpdates.push(pending);
  }
  return pending;
}

function pendingCount(state: WatchState): number {
  return state.pendingPrUpdates.reduce(
    (count, pending) =>
      count + (pending.checksKey ? 1 : 0) + (pending.conflictsKey ? 1 : 0) + pending.feedbackActivities.length,
    state.pendingShaUpdate ? 1 : 0,
  );
}

function statusText(state: WatchState): string | undefined {
  const pending = pendingCount(state);
  const suffix = pending > 0 ? ` • ${pending} pending` : "";
  if (state.mode === "off") return undefined;
  if (state.mode === "paused") return `PR watch: paused${suffix}`;
  if (state.watchedPrs.length > 0) {
    return `PR watch: ${state.watchedPrs.map(({ pr }) => `${pr.repo.split("/").at(-1)}#${pr.number}`).join(", ")}${suffix}`;
  }
  if (state.watchedSha) return `SHA ${state.watchedSha.sha.slice(0, 7)} watch${suffix}`;
  if (state.orchestrationSessionId) return `PR watch:${suffix}`;
  return pending > 0 ? `PR watch:${suffix}` : undefined;
}

function orchestrationRoot(): string {
  return (
    process.env.PI_PR_WATCH_STATE_DIR ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "pi", "pr-watch", "orchestrations")
  );
}

function orchestrationDirectory(orchestrationID: string): string {
  return join(orchestrationRoot(), encodeURIComponent(orchestrationID));
}

function reviewerSafetyNotice(pr: WatchedPr, selfLogin: string | undefined): string | undefined {
  if (selfLogin && pr.authorLogin === selfLogin) return undefined;
  if (pr.authorLogin) {
    return `This PR is authored by ${pr.authorLogin}, not you. Do not edit files, commit, push, comment, review, approve, merge, close, or otherwise mutate the PR unless the user explicitly asks for that specific action.`;
  }
  return "I could not determine whether this PR is authored by you. Do not edit files, commit, push, comment, review, or otherwise mutate the PR unless the user explicitly asks for that specific action.";
}

function buildChecksMessage(pr: WatchedPr, orchestration: boolean, selfLogin: string | undefined): string {
  const identity = `${pr.repo}#${pr.number}`;
  if (orchestration) {
    return `CI finished for worker PR ${identity}. Inspect the PR checks and coordinate the worker if action is required.\n\n${pr.url}`;
  }
  const safety = reviewerSafetyNotice(pr, selfLogin);
  if (safety) return `CI finished for ${identity}, which you are reviewing.\n\n${safety}\n\nInspect the CI result as reviewer context and summarize any recommended follow-up.\n\n${pr.url}`;
  return `CI finished for ${identity}.\n\nPlease inspect the PR checks/results with gh, determine whether anything needs to be fixed, and take appropriate action. If they failed, diagnose and fix them. Verify generated diffs before you treat green checks as complete.\n\n${pr.url}`;
}

function buildFeedbackMessage(pr: WatchedPr, activities: TrackedActivity[], orchestration: boolean, selfLogin: string | undefined): string {
  const identity = `${pr.repo}#${pr.number}`;
  const authors = [...new Set(activities.map((activity) => activity.authorLogin).filter(Boolean))].join(", ");
  if (orchestration) {
    return `New review feedback arrived for worker PR ${identity}${authors ? ` from ${authors}` : ""}. Inspect it and coordinate the worker if action is required.\n\n${pr.url}`;
  }
  const safety = reviewerSafetyNotice(pr, selfLogin);
  if (safety) return `New review feedback arrived for ${identity}${authors ? ` from ${authors}` : ""}.\n\n${safety}\n\nInspect it as reviewer context and summarize whether it changes your review.\n\n${pr.url}`;
  return `New review feedback arrived for ${identity}${authors ? ` from ${authors}` : ""}. Inspect the review, decide what is valid, and take appropriate action.\n\n${pr.url}`;
}

function buildConflictMessage(pr: WatchedPr, orchestration: boolean, selfLogin: string | undefined): string {
  const identity = `${pr.repo}#${pr.number}`;
  if (orchestration) return `Worker PR ${identity} now has merge conflicts. Coordinate the worker to resolve them.\n\n${pr.url}`;
  const safety = reviewerSafetyNotice(pr, selfLogin);
  return safety
    ? `PR ${identity} now has merge conflicts.\n\n${safety}\n\nInspect the conflict status as reviewer context and summarize the follow-up needed.\n\n${pr.url}`
    : `PR ${identity} now has merge conflicts. Inspect and resolve them.\n\n${pr.url}`;
}

function buildShaMessage(update: PendingShaUpdate): string {
  return `CI finished for SHA ${update.sha.slice(0, 7)}. Inspect the workflow runs/results with gh and take appropriate action. Verify generated diffs before you treat green runs as complete.\n\nRepo: ${update.repo}\nSHA: ${update.sha}`;
}

function statusSummary(state: WatchState): string {
  const prs = state.watchedPrs.length
    ? state.watchedPrs
        .map(({ pr, seenActivityIds }) =>
          `PR ${pr.repo}#${pr.number} ${pr.url}\n  branch: ${pr.branch}\n  head: ${pr.headSha}\n  author: ${pr.authorLogin ?? "unknown"}\n  seen activity: ${seenActivityIds.length}`,
        )
        .join("\n")
    : "none";
  const lines = [
    `PR watch mode: ${state.mode}`,
    `pending updates: ${pendingCount(state)}`,
    `watched PRs:\n${prs}`,
    `watched SHA: ${state.watchedSha ? `${state.watchedSha.repo}@${state.watchedSha.sha}` : "none"}`,
    `orchestration: ${state.orchestrationSessionId ?? "none"}`,
    `last poll: ${state.lastPollAt ? new Date(state.lastPollAt).toLocaleString() : "never"}`,
    `last notify: ${state.lastNotifyAt ? new Date(state.lastNotifyAt).toLocaleString() : "never"}`,
  ];
  if (state.lastError) lines.push(`last error: ${state.lastError}`);
  return lines.join("\n");
}

export async function createPrWatchController(options: ControllerOptions) {
  const root = options.root ?? stateRoot();
  const notify = options.notify ?? (() => undefined);
  let state = initialState();
  let polling = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let currentRepo: string | undefined;

  async function run<T>(
    command: string,
    args: string[],
    acceptErrorOutput: false | "json" | "empty-array" = false,
  ): Promise<T | undefined> {
    try {
      const result = await execFileAsync(command, args, { cwd: options.directory, timeout: 30_000 });
      if (!result.stdout.trim()) return undefined;
      return JSON.parse(result.stdout) as T;
    } catch (error) {
      if (acceptErrorOutput && isObject(error) && typeof error.stdout === "string") {
        if (error.stdout.trim()) {
          try {
            return JSON.parse(error.stdout) as T;
          } catch {
            // Report the original command error below.
          }
        } else if (acceptErrorOutput === "empty-array") {
          return [] as T;
        }
      }
      state.lastError = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  }

  async function refreshSelfLogin(): Promise<void> {
    state.selfLogin = (await run<{ login?: string }>("gh", ["api", "user"]))?.login;
  }

  async function save(): Promise<void> {
    await atomicWriteJson(sessionStatePath(root, options.sessionID), state);
    const status: StatusSnapshot = {
      version: 1,
      sessionID: options.sessionID,
      text: statusText(state),
      warning: state.mode === "paused" || pendingCount(state) > 0 || Boolean(state.lastError),
      updatedAt: Date.now(),
    };
    await atomicWriteJson(statusPath(root, options.sessionID), status);
  }

  function hasTargets(): boolean {
    return state.watchedPrs.length > 0 || Boolean(state.watchedSha) || Boolean(state.orchestrationSessionId);
  }

  function startPolling(): void {
    if (interval || state.mode === "off" || !hasTargets()) return;
    interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (interval) clearInterval(interval);
    interval = undefined;
  }

  async function ensureCurrentRepo(): Promise<string | undefined> {
    if (currentRepo) return currentRepo;
    currentRepo = (await run<{ nameWithOwner: string }>("gh", ["repo", "view", "--json", "nameWithOwner"]))?.nameWithOwner;
    return currentRepo;
  }

  async function baselinePr(watched: WatchedPrState): Promise<boolean> {
    const [activities, checks] = await Promise.all([
      fetchActivities(watched.pr),
      run<Check[]>("gh", [
        "pr",
        "checks",
        watched.pr.url,
        "--json",
        "name,state,bucket,workflow,link,completedAt",
      ], "empty-array"),
    ]);
    if (!activities || checks === undefined) return false;
    watched.seenActivityIds = activities.map((activity) => activity.id);
    if (checks.length > 0 && checks.every(isTerminalCheck)) {
      watched.notifiedChecksKey = checksCompletionKey(watched.pr.headSha, checks);
    }
    watched.baselinePending = undefined;
    return true;
  }

  async function fetchActivities(pr: WatchedPr): Promise<TrackedActivity[] | undefined> {
    const [issueComments, reviews, reviewComments] = await Promise.all([
      run<Activity[]>("gh", ["api", `repos/${pr.repo}/issues/${pr.number}/comments?per_page=100`]),
      run<Activity[]>("gh", ["api", `repos/${pr.repo}/pulls/${pr.number}/reviews?per_page=100`]),
      run<Activity[]>("gh", ["api", `repos/${pr.repo}/pulls/${pr.number}/comments?per_page=100`]),
    ]);
    if (!issueComments || !reviews || !reviewComments) return undefined;
    const result: TrackedActivity[] = [];
    for (const [kind, activities] of [
      ["issue-comment", issueComments],
      ["review", reviews],
      ["review-comment", reviewComments],
    ] as Array<[ActivityKind, Activity[]]>) {
      for (const activity of activities) {
        if (!shouldTrackActivity(kind, activity)) continue;
        result.push({ id: `${kind}:${activity.id}`, authorLogin: activityAuthor(activity) });
      }
    }
    return result;
  }

  async function discover(reason: string, target?: string, showNotification = true): Promise<boolean> {
    if (state.mode === "off") return false;
    const repo = (target ? repositoryFromPrUrl(target) : undefined) ?? (await ensureCurrentRepo());
    if (!repo) return false;
    const args = ["pr", "view"];
    if (target) args.push(target);
    args.push("--json", "number,url,headRefName,headRefOid,state,author,mergeable");
    const value = await run<any>("gh", args);
    if (!value) return false;
    if (value.state !== "OPEN") {
      if (showNotification) notify(`PR #${value.number} is not open; it was not added to PR watch.`, "info");
      return false;
    }
    const pr: WatchedPr = {
      repo,
      number: value.number,
      url: value.url,
      branch: value.headRefName,
      headSha: value.headRefOid,
      authorLogin: value.author?.login,
    };
    const existing = state.watchedPrs.find((item) => prIdentityKey(item.pr) === prIdentityKey(pr));
    if (existing) {
      if (existing.pr.headSha !== pr.headSha) {
        existing.notifiedChecksKey = undefined;
        const pending = state.pendingPrUpdates.find((item) => prIdentityKey(item.pr) === prIdentityKey(pr));
        if (pending) {
          pending.pr = structuredClone(pr);
          if (pending.checksHeadSha && pending.checksHeadSha !== pr.headSha) {
            pending.checksHeadSha = undefined;
            pending.checksKey = undefined;
          }
          removeEmptyPendingPr(state, pr);
        }
        existing.baselinePending = !state.orchestrationSessionId || undefined;
      }
      existing.pr = pr;
      if (existing.baselinePending) await baselinePr(existing);
    } else {
      const watched: WatchedPrState = {
        pr,
        seenActivityIds: [],
        mergeable: value.mergeable,
        baselinePending: true,
      };
      state.watchedPrs.push(watched);
      const baselined = await baselinePr(watched);
      if (baselined && state.orchestrationSessionId) watched.notifiedChecksKey = undefined;
      if (showNotification) notify(`PR watch added #${pr.number} (${reason}).`, "info");
    }
    if (!state.orchestrationSessionId) state.watchedSha = undefined;
    await save();
    startPolling();
    return true;
  }

  function removePr(pr: WatchedPr): void {
    state.watchedPrs = state.watchedPrs.filter((item) => prIdentityKey(item.pr) !== prIdentityKey(pr));
    state.pendingPrUpdates = state.pendingPrUpdates.filter((item) => prIdentityKey(item.pr) !== prIdentityKey(pr));
  }

  async function syncWatchedSha(): Promise<void> {
    const repo = await ensureCurrentRepo();
    if (!repo) return;
    const branchResult = await execFileAsync("git", ["branch", "--show-current"], {
      cwd: options.directory,
      timeout: 30_000,
    }).catch(() => undefined);
    const branch = branchResult?.stdout.trim();
    if (!branch) return;
    const commit = await run<{ sha?: string }>("gh", ["api", `repos/${repo}/commits/${encodeURIComponent(branch)}`]);
    const sha = commit?.sha;
    if (!sha || state.watchedSha?.sha === sha) return;

    const firstObservation = !state.watchedSha;
    state.watchedSha = { repo, sha, baselinePending: firstObservation || undefined };
    state.pendingShaUpdate = undefined;
    if (!firstObservation) return;

    await baselineWatchedSha();
  }

  async function baselineWatchedSha(): Promise<boolean> {
    if (!state.watchedSha?.baselinePending) return true;
    const { sha } = state.watchedSha;
    const runs = await run<WorkflowRun[]>("gh", [
      "run",
      "list",
      "--commit",
      sha,
      "--json",
      "databaseId,attempt,name,workflowName,status,conclusion,url,createdAt,updatedAt",
    ]);
    if (!runs) return false;
    if (runs.length > 0 && runs.every(isTerminalRun)) {
      state.watchedSha.notifiedChecksKey = runsCompletionKey(sha, runs);
    }
    state.watchedSha.baselinePending = undefined;
    return true;
  }

  async function reconcileOrchestrationMembership(): Promise<void> {
    const orchestrationID = state.orchestrationSessionId;
    if (!orchestrationID) return;
    const directory = orchestrationDirectory(orchestrationID);
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (isObject(error) && error.code === "ENOENT") return [];
      throw error;
    });
    const snapshots: Record<string, WorkerWatchSnapshot> = {};
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const value: unknown = JSON.parse(await readFile(join(directory, entry.name), "utf8"));
      if (!isWorkerWatchSnapshot(value) || value.orchestrationId !== orchestrationID) continue;
      snapshots[value.workerSessionId] = value;
    }
    state.workerSnapshots = snapshots;
    const desired = new Map<string, Pick<WatchedPr, "repo" | "number" | "url">>();
    for (const snapshot of Object.values(snapshots)) {
      for (const pr of snapshot.watchedPrs) desired.set(prIdentityKey(pr), pr);
    }
    for (const watched of [...state.watchedPrs]) {
      if (!desired.has(prIdentityKey(watched.pr))) removePr(watched.pr);
    }
    const resolved = new Set(state.resolvedOrchestrationPrUrls ?? []);
    for (const pr of desired.values()) {
      if (resolved.has(pr.url) || state.watchedPrs.some((item) => prIdentityKey(item.pr) === prIdentityKey(pr))) continue;
      await discover("worker snapshot", pr.url, false);
    }
  }

  async function pollPr(watched: WatchedPrState): Promise<number> {
    if (watched.baselinePending && !(await baselinePr(watched))) return 0;
    const latest = await run<any>("gh", ["pr", "view", watched.pr.url, "--json", "headRefOid,headRefName,state,author,mergeable"]);
    if (!latest) return 0;
    if (latest.state !== "OPEN") {
      if (state.orchestrationSessionId) {
        state.resolvedOrchestrationPrUrls = [...new Set([...(state.resolvedOrchestrationPrUrls ?? []), watched.pr.url])];
      }
      removePr(watched.pr);
      return 0;
    }
    const oldHead = watched.pr.headSha;
    watched.pr = { ...watched.pr, headSha: latest.headRefOid, branch: latest.headRefName ?? watched.pr.branch, authorLogin: latest.author?.login };
    if (oldHead !== latest.headRefOid) {
      watched.notifiedChecksKey = undefined;
      const pending = state.pendingPrUpdates.find((item) => prIdentityKey(item.pr) === prIdentityKey(watched.pr));
      if (pending) {
        pending.pr = structuredClone(watched.pr);
        pending.checksHeadSha = undefined;
        pending.checksKey = undefined;
        removeEmptyPendingPr(state, watched.pr);
      }
    }
    let added = 0;
    const checks = await run<Check[]>("gh", ["pr", "checks", watched.pr.url, "--json", "name,state,bucket,workflow,link,completedAt"], "empty-array");
    const allTerminal = checks !== undefined && checks.length > 0 && checks.every(isTerminalCheck);
    const key = checksCompletionKey(watched.pr.headSha, checks ?? []);
    const pending = pendingFor(state, watched.pr);
    if (!allTerminal || pending.checksKey !== key) {
      if (pending.checksKey) {
        pending.checksKey = undefined;
        pending.checksHeadSha = undefined;
      }
    }
    const notifiable = allTerminal && (!state.orchestrationSessionId || !checks?.some(isFailingCheck));
    if (notifiable && watched.notifiedChecksKey !== key) {
      watched.notifiedChecksKey = key;
      pending.checksHeadSha = watched.pr.headSha;
      pending.checksKey = key;
      added += 1;
    }
    const activities = await fetchActivities(watched.pr);
    if (activities) {
      const seen = new Set(watched.seenActivityIds);
      const fresh = activities.filter((activity) => !seen.has(activity.id));
      watched.seenActivityIds = activities.map((activity) => activity.id);
      if (fresh.length) {
        const pendingIDs = new Set(pending.feedbackActivities.map((activity) => activity.id));
        const external = fresh.filter((activity) => {
          if (!state.selfLogin || activity.authorLogin !== state.selfLogin) return true;
          const id = bareActivityId(activity.id);
          return !state.recentGhOutputs.some((output) => output.includes(id));
        });
        pending.feedbackActivities.push(...external.filter((activity) => !pendingIDs.has(activity.id)));
        added += external.length;
      }
    }
    if (!state.orchestrationSessionId && latest.mergeable === "CONFLICTING" && watched.mergeable !== "CONFLICTING") {
      pending.conflictsKey = `${watched.pr.headSha}:conflicting`;
      added += 1;
    }
    if (latest.mergeable === "MERGEABLE" && pending.conflictsKey) pending.conflictsKey = undefined;
    watched.mergeable = latest.mergeable;
    removeEmptyPendingPr(state, watched.pr);
    return added;
  }

  async function pollSha(): Promise<number> {
    if (!state.watchedSha || !(await baselineWatchedSha())) return 0;
    const runs = await run<WorkflowRun[]>("gh", ["run", "list", "--commit", state.watchedSha.sha, "--json", "databaseId,attempt,name,workflowName,status,conclusion,url,createdAt,updatedAt"]);
    if (!runs) return 0;
    const allTerminal = runs.length > 0 && runs.every(isTerminalRun);
    const key = runsCompletionKey(state.watchedSha.sha, runs);
    if (!allTerminal || state.watchedSha.notifiedChecksKey === key) return 0;
    state.watchedSha.notifiedChecksKey = key;
    state.pendingShaUpdate = { repo: state.watchedSha.repo, sha: state.watchedSha.sha, runsKey: key };
    return 1;
  }

  async function flushPending(): Promise<void> {
    if (state.mode !== "active" || pendingCount(state) === 0) return;
    const messages: string[] = [];
    for (const pending of state.pendingPrUpdates) {
      const orchestration = Boolean(state.orchestrationSessionId);
      if (pending.checksKey) messages.push(buildChecksMessage(pending.pr, orchestration, state.selfLogin));
      if (pending.conflictsKey) messages.push(buildConflictMessage(pending.pr, orchestration, state.selfLogin));
      if (pending.feedbackActivities.length) messages.push(buildFeedbackMessage(pending.pr, pending.feedbackActivities, orchestration, state.selfLogin));
    }
    if (state.pendingShaUpdate) messages.push(buildShaMessage(state.pendingShaUpdate));
    if (!messages.length) return;
    const marker = randomUUID();
    await options.wake(`${messages.join("\n\n---\n\n")}\n\n<!-- pr-watch-delivery:${marker} -->`);
    state.pendingPrUpdates = [];
    state.pendingShaUpdate = undefined;
    state.lastNotifyAt = Date.now();
    await save();
  }

  async function poll(): Promise<void> {
    if (polling || state.mode === "off") return;
    polling = true;
    try {
      if (state.orchestrationSessionId) await reconcileOrchestrationMembership();
      if (state.orchestrationSessionId || state.watchedSha) await syncWatchedSha();
      let added = await pollSha();
      for (const watched of [...state.watchedPrs]) added += await pollPr(watched);
      state.lastPollAt = Date.now();
      await save();
      if (added > 0 && state.mode === "paused") notify(`PR Watch buffered ${added} update${added === 1 ? "" : "s"} (${pendingCount(state)} pending).`, "info");
      await flushPending();
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      await save();
    } finally {
      polling = false;
    }
  }

  async function adoptRegistration(registration: Registration): Promise<void> {
    if (state.orchestrationSessionId || !registration.orchestrationID) return;
    state = initialState();
    state.orchestrationSessionId = registration.orchestrationID;
    await refreshSelfLogin();
    await reconcileOrchestrationMembership();
    await syncWatchedSha();
    await save();
    startPolling();
  }

  async function initialize(): Promise<void> {
    const saved = await import("./pr-watch-ipc.ts").then(({ readJson }) => readJson<WatchState>(sessionStatePath(root, options.sessionID)));
    if (isWatchState(saved)) state = structuredClone(saved);
    const registration = await import("./pr-watch-ipc.ts").then(({ readJson }) => readJson<Registration>(registrationPath(root, options.sessionID)));
    if (!state.orchestrationSessionId && registration?.orchestrationID) {
      state = initialState();
      state.orchestrationSessionId = registration.orchestrationID;
    }
    if (state.mode !== "off") {
      await refreshSelfLogin();
      for (const watched of [...state.watchedPrs]) await discover("startup", watched.pr.url, false);
      if (state.orchestrationSessionId) {
        await reconcileOrchestrationMembership();
        await syncWatchedSha();
      } else if (state.watchedPrs.length === 0 && state.watchedSha) {
        await syncWatchedSha();
      }
    }
    await save();
    startPolling();
    await flushPending();
  }

  async function observeShell(command: string, output: string, succeeded: boolean): Promise<void> {
    if (!succeeded || state.mode === "off") return;
    if (commandUsesGh(command)) {
      state.recentGhOutputs = [...state.recentGhOutputs, output].slice(-MAX_RECENT_GH_OUTPUTS);
      await save();
    }
    if (isActivationCommand(command)) await discover("gh pr command", pullRequestUrlFromText(output));
    else if (isGitPush(command)) {
      if (!(await discover("git push", undefined, false))) {
        await syncWatchedSha();
        await save();
        startPolling();
      }
    }
  }

  async function command(input: string, id: string = randomUUID()): Promise<CommandResponse> {
    const [rawAction = "status", ...rest] = input.trim().split(/\s+/).filter(Boolean);
    const action = rawAction.toLowerCase();
    const target = rest.join(" ");
    let message = "";
    let variant: CommandResponse["variant"] = "info";
    if (action === "on" || action === "resume") {
      state.mode = "active";
      startPolling();
      if (hasTargets()) await poll();
      else await discover(`manual ${action}`);
      message = `PR watch ${action === "on" ? "enabled" : "resumed"}.`;
    } else if (action === "pause") {
      state.mode = "paused";
      startPolling();
      message = "PR watch notifications paused; polling continues.";
    } else if (action === "off") {
      state.mode = "off";
      stopPolling();
      message = "PR watch disabled for this session.";
    } else if (action === "add") {
      if (!target) {
        message = "Usage: /pr-watch add <number-or-url>";
        variant = "warning";
      } else {
        state.mode = "active";
        message = (await discover("manual add", target)) ? "PR added to PR watch." : "Could not add the PR.";
      }
    } else if (action === "remove") {
      const number = Number(target.match(/\d+$/)?.[0]);
      const repo = repositoryFromPrUrl(target);
      const watched = state.watchedPrs.find((item) => item.pr.number === number && (!repo || item.pr.repo.toLowerCase() === repo.toLowerCase()));
      if (!Number.isInteger(number) || number <= 0) {
        message = "Usage: /pr-watch remove <number-or-url>";
        variant = "warning";
      } else {
        if (watched) removePr(watched.pr);
        message = watched ? `Removed PR #${number} from PR watch.` : `PR #${number} was not being watched.`;
      }
    } else if (action === "reset") {
      stopPolling();
      const orchestrationSessionId = state.orchestrationSessionId;
      state = initialState();
      state.orchestrationSessionId = orchestrationSessionId;
      if (orchestrationSessionId) {
        await reconcileOrchestrationMembership();
        await syncWatchedSha();
      } else await discover("manual reset", undefined, false);
      startPolling();
      message = "PR watch reset.";
    } else if (action === "status") {
      message = statusSummary(state);
      variant = state.lastError ? "warning" : "info";
    } else {
      message = "Usage: /pr-watch [status|on|off|pause|resume|add <number-or-url>|remove <number-or-url>|reset]";
      variant = "warning";
    }
    await save();
    const response: CommandResponse = { version: 1, id, sessionID: options.sessionID, message, variant, createdAt: Date.now() };
    await atomicWriteJson(commandResponsePath(root, options.sessionID, id), response);
    return response;
  }

  return {
    initialize,
    adoptRegistration,
    observeShell,
    poll,
    command,
    dispose: () => stopPolling(),
    getState: () => structuredClone(state),
  };
}
