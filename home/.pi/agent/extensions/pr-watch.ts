import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
  mergeable?: string;
};

type WatchedSha = {
  repo: string;
  sha: string;
  notifiedChecksKey?: string;
};

type WatchMode = "active" | "paused" | "off";

type PendingPrUpdate = {
  pr: WatchedPr;
  checksHeadSha?: string;
  checksKey?: string;
  conflictsKey?: string;
  feedbackActivities: TrackedActivity[];
};

type PendingShaUpdate = {
  repo: string;
  sha: string;
  runsKey: string;
};

type PendingDelivery = {
  id: string;
  message: string;
  pendingPrUpdates: PendingPrUpdate[];
  pendingShaUpdate?: PendingShaUpdate;
};

type WorkerWatchSnapshot = {
  version: 1;
  orchestrationId: string;
  workerSessionId: string;
  revision: number;
  watchedPrs: Array<Pick<WatchedPr, "repo" | "number" | "url">>;
};

type WatchState = {
  version: 4;
  mode: WatchMode;
  watchedPrs: WatchedPrState[];
  watchedSha?: WatchedSha;
  pendingPrUpdates: PendingPrUpdate[];
  pendingShaUpdate?: PendingShaUpdate;
  pendingDelivery?: PendingDelivery;
  recentGhOutputs: string[];
  orchestrationSessionId?: string;
  workerOrchestrationSessionId?: string;
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
  addedCount: number;
  remove?: boolean;
  error?: string;
};

const CUSTOM_STATE = "pr-watch-state";
const POLL_INTERVAL_MS = 60_000;
const MAX_RECENT_GH_OUTPUTS = 3;
const WORKER_ORCHESTRATION_ENV = "PI_PARENT_ORCHESTRATION_SESSION_ID";

const initialState = (): WatchState => ({
  version: 4,
  mode: "active",
  watchedPrs: [],
  pendingPrUpdates: [],
  recentGhOutputs: [],
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWatchState(value: unknown): value is WatchState {
  return (
    isObject(value) &&
    value.version === 4 &&
    ["active", "paused", "off"].includes(String(value.mode)) &&
    Array.isArray(value.watchedPrs) &&
    Array.isArray(value.pendingPrUpdates)
  );
}

function isBashToolResultLike(event: unknown): event is BashToolResultLike {
  if (!isObject(event) || event.toolName !== "bash" || !isObject(event.input)) return false;
  return typeof event.input.command === "string";
}

function isTextContent(value: unknown): value is { text: string } {
  return isObject(value) && typeof value.text === "string";
}

function isDefinitiveMergeable(value: string | undefined): value is "MERGEABLE" | "CONFLICTING" {
  return value === "MERGEABLE" || value === "CONFLICTING";
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

export function prIdentityKey(pr: Pick<WatchedPr, "repo" | "number">): string {
  return `${pr.repo.toLowerCase()}#${pr.number}`;
}

export function prStatusIdentity(
  pr: Pick<WatchedPr, "repo" | "number">,
  currentRepo: string | undefined,
): string {
  if (currentRepo?.toLowerCase() === pr.repo.toLowerCase()) return `#${pr.number}`;
  const repoName = pr.repo.split("/").filter(Boolean).at(-1) ?? pr.repo;
  return `${repoName}#${pr.number}`;
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
  let deliveryAttemptedId: string | undefined;
  let lastPublishedMembership: string | undefined;
  let currentRepo: string | undefined;
  let currentRepoLookup: Promise<string | undefined> | undefined;
  let snapshotPublishQueue = Promise.resolve();
  const coordinationRoot =
    process.env.PI_PR_WATCH_STATE_DIR ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "pi", "pr-watch", "orchestrations");

  function hasTargets(): boolean {
    return state.watchedPrs.length > 0 || Boolean(state.watchedSha) || Boolean(state.orchestrationSessionId);
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

  function save(): void {
    pi.appendEntry(CUSTOM_STATE, state);
  }

  function orchestrationDirectory(orchestrationId: string): string {
    return join(coordinationRoot, encodeURIComponent(orchestrationId));
  }

  function workerSnapshotPath(orchestrationId: string, workerSessionId: string): string {
    return join(orchestrationDirectory(orchestrationId), `${encodeURIComponent(workerSessionId)}.json`);
  }

  function membershipFingerprint(): string {
    return state.watchedPrs
      .map(({ pr }) => `${prIdentityKey(pr)}:${pr.url}`)
      .sort()
      .join("\n");
  }

  async function publishWorkerSnapshot(ctx: ExtensionContext, force = false): Promise<void> {
    snapshotPublishQueue = snapshotPublishQueue.then(async () => {
      const orchestrationId = state.workerOrchestrationSessionId;
      if (!orchestrationId) return;

      const fingerprint = membershipFingerprint();
      if (!force && fingerprint === lastPublishedMembership) return;

      const workerSessionId = ctx.sessionManager.getSessionId();
      const path = workerSnapshotPath(orchestrationId, workerSessionId);
      const snapshot: WorkerWatchSnapshot = {
        version: 1,
        orchestrationId,
        workerSessionId,
        revision: Date.now(),
        watchedPrs: state.watchedPrs.map(({ pr }) => ({
          repo: pr.repo,
          number: pr.number,
          url: pr.url,
        })),
      };

      try {
        await mkdir(orchestrationDirectory(orchestrationId), { recursive: true, mode: 0o700 });
        const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
        await rename(temporaryPath, path);
        lastPublishedMembership = fingerprint;
      } catch (error) {
        state.lastError = `Could not publish worker PR watch membership: ${error instanceof Error ? error.message : String(error)}`;
        save();
        setStatus(ctx);
      }
    });
    await snapshotPublishQueue;
  }

  async function reconcileOrchestrationMembership(ctx: ExtensionContext): Promise<string[]> {
    const orchestrationId = state.orchestrationSessionId;
    if (!orchestrationId) return [];

    const errors: string[] = [];
    let entries: Array<{ name: string; isFile(): boolean }> = [];
    try {
      entries = await readdir(orchestrationDirectory(orchestrationId), { withFileTypes: true });
    } catch (error) {
      if (!isObject(error) || error.code !== "ENOENT") {
        errors.push(`Could not read orchestration worker snapshots: ${error instanceof Error ? error.message : String(error)}`);
        return errors;
      }
    }

    const snapshots = { ...(state.workerSnapshots ?? {}) };
    const presentWorkerIds = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let workerSessionId: string;
      try {
        workerSessionId = decodeURIComponent(entry.name.slice(0, -".json".length));
      } catch {
        errors.push(`Invalid worker snapshot filename: ${entry.name}`);
        continue;
      }
      presentWorkerIds.add(workerSessionId);

      try {
        const value: unknown = JSON.parse(
          await readFile(join(orchestrationDirectory(orchestrationId), entry.name), "utf8"),
        );
        if (
          !isWorkerWatchSnapshot(value) ||
          value.orchestrationId !== orchestrationId ||
          value.workerSessionId !== workerSessionId ||
          value.watchedPrs.some((pr) => {
            const coordinates = prCoordinatesFromUrl(pr.url);
            return (
              !coordinates ||
              coordinates.number !== pr.number ||
              coordinates.repo.toLowerCase() !== pr.repo.toLowerCase()
            );
          })
        ) {
          throw new Error("snapshot identity, schema, or PR coordinates do not match");
        }
        snapshots[workerSessionId] = value;
      } catch (error) {
        errors.push(
          `Could not read worker snapshot ${workerSessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    for (const workerSessionId of Object.keys(snapshots)) {
      if (!presentWorkerIds.has(workerSessionId)) delete snapshots[workerSessionId];
    }
    state.workerSnapshots = snapshots;

    const desired = new Map<string, Pick<WatchedPr, "repo" | "number" | "url">>();
    for (const snapshot of Object.values(snapshots)) {
      for (const pr of snapshot.watchedPrs) desired.set(prIdentityKey(pr), pr);
    }

    const desiredUrls = new Set([...desired.values()].map((pr) => pr.url));
    state.resolvedOrchestrationPrUrls = (state.resolvedOrchestrationPrUrls ?? []).filter((url) =>
      desiredUrls.has(url),
    );
    const resolved = new Set(state.resolvedOrchestrationPrUrls);

    for (const watched of [...state.watchedPrs]) {
      if (!desired.has(prIdentityKey(watched.pr))) removePr(watched.pr);
    }
    for (const pr of desired.values()) {
      if (resolved.has(pr.url)) continue;
      if (state.watchedPrs.some((watched) => prIdentityKey(watched.pr) === prIdentityKey(pr))) continue;
      try {
        await discover(ctx, "worker snapshot", false, pr.url);
      } catch (error) {
        errors.push(
          `Could not enroll worker PR ${pr.repo}#${pr.number}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return errors;
  }

  function pendingCount(): number {
    return state.pendingPrUpdates.reduce(
      (count, pending) =>
        count + (pending.checksKey ? 1 : 0) + (pending.conflictsKey ? 1 : 0) + pending.feedbackActivities.length,
      state.pendingShaUpdate ? 1 : 0,
    );
  }

  function statusText(): string | undefined {
    const pending = pendingCount();
    const pendingSuffix = pending > 0 ? ` • ${pending} pending` : "";

    if (state.mode === "off") return undefined;
    if (state.mode === "paused") return `PR watch: paused${pendingSuffix}`;
    if (!hasTargets() && pending === 0) return undefined;

    if (state.watchedPrs.length > 0) {
      const prs = state.watchedPrs.map(({ pr }) => prStatusIdentity(pr, currentRepo)).join(", ");
      return `PR watch: ${prs}${pendingSuffix}`;
    }

    if (state.watchedSha) return `SHA ${state.watchedSha.sha.slice(0, 7)} watch${pendingSuffix}`;
    return `PR watch:${pendingSuffix}`;
  }

  function setStatus(ctx: ExtensionContext): void {
    const text = statusText();
    const highlighted = text && (state.mode === "paused" || pendingCount() > 0)
      ? ctx.ui.theme?.fg?.("warning", text) ?? text
      : text;
    ctx.ui.setStatus("pr-watch", highlighted);
  }

  function startPolling(ctx: ExtensionContext): void {
    if (interval || state.mode === "off" || !hasTargets()) return;
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

  async function ensureCurrentRepo(ctx: ExtensionContext): Promise<string | undefined> {
    currentRepoLookup ??= (async () => {
      const repo = await execJson<{ nameWithOwner: string }>("gh", ["repo", "view", "--json", "nameWithOwner"], ctx);
      currentRepo = repo?.nameWithOwner;
      return currentRepo;
    })();
    return currentRepoLookup;
  }

  async function discover(
    ctx: ExtensionContext,
    reason: string,
    notify = true,
    prTarget?: string,
    alreadyEnrolled = false,
  ): Promise<boolean> {
    if (state.mode === "off") return false;

    const repoForCurrentDirectory = await ensureCurrentRepo(ctx);
    const repoName = (prTarget ? repositoryFromPrUrl(prTarget) : undefined) ?? repoForCurrentDirectory;
    if (!repoName) return false;

    const prViewArgs = ["pr", "view"];
    if (prTarget) prViewArgs.push(prTarget);
    prViewArgs.push("--json", "number,url,headRefName,headRefOid,state,author,mergeable");
    const pr = await execJson<{
      number: number;
      url: string;
      headRefName: string;
      headRefOid: string;
      state: string;
      author?: { login?: string };
      mergeable?: string;
    }>("gh", prViewArgs, ctx);

    if (!pr && prTarget) {
      state.lastError = `Could not resolve PR ${prTarget}`;
      save();
      setStatus(ctx);
      return false;
    }

    if (pr?.state === "OPEN") {
      await refreshSelfLogin(ctx);

      const watchedPr: WatchedPr = {
        repo: repositoryFromPrUrl(pr.url) ?? repoName,
        number: pr.number,
        url: pr.url,
        branch: pr.headRefName,
        headSha: pr.headRefOid,
        authorLogin: pr.author?.login,
      };
      const watchedKey = prIdentityKey(watchedPr);
      const existing = state.watchedPrs.find((candidate) => prIdentityKey(candidate.pr) === watchedKey);
      const wasAlreadyWatched = Boolean(existing);
      if (existing) {
        existing.pr = watchedPr;
        if (alreadyEnrolled) {
          if (pr.mergeable === "MERGEABLE") clearPendingConflict(existing.pr);
          if (isDefinitiveMergeable(pr.mergeable)) existing.mergeable = pr.mergeable;
          await baselinePrState(existing, ctx);
        }
      } else {
        const added: WatchedPrState = {
          pr: watchedPr,
          seenActivityIds: [],
          mergeable: isDefinitiveMergeable(pr.mergeable) ? pr.mergeable : undefined,
        };
        state.watchedPrs.push(added);
        await baselinePrState(added, ctx);
      }
      reconcilePendingPr(watchedPr);

      state.watchedSha = undefined;
      state.pendingShaUpdate = undefined;
      state.lastError = undefined;
      save();
      startPolling(ctx);
      setStatus(ctx);
      state.resolvedOrchestrationPrUrls = (state.resolvedOrchestrationPrUrls ?? []).filter(
        (url) => url !== watchedPr.url,
      );
      await publishWorkerSnapshot(ctx);
      if (notify && !wasAlreadyWatched) ctx.ui.notify(`PR watch added #${pr.number} (${reason}).`, "info");
      return true;
    }

    if (prTarget) {
      if (pr) {
        const unresolvedPr = {
          repo: repositoryFromPrUrl(pr.url) ?? repoName,
          number: pr.number,
        };
        removePr(unresolvedPr);
        if (state.orchestrationSessionId) {
          state.resolvedOrchestrationPrUrls = [
            ...new Set([...(state.resolvedOrchestrationPrUrls ?? []), pr.url]),
          ];
        }
      }
      save();
      setStatus(ctx);
      await publishWorkerSnapshot(ctx);
      if (notify && pr) ctx.ui.notify(`PR #${pr.number} is not open; it was not added to PR watch.`, "info");
      return false;
    }

    if (state.orchestrationSessionId) return false;

    const sha = await currentSha();
    if (!sha) return false;

    await refreshSelfLogin(ctx);

    if (state.watchedSha?.sha !== sha) state.pendingShaUpdate = undefined;
    state.watchedSha = { repo: repoName, sha };
    await baselineCurrentShaState(ctx);

    state.lastError = undefined;
    save();
    startPolling(ctx);
    if (notify) ctx.ui.notify(`PR watch active for SHA ${sha.slice(0, 7)} (${reason}).`, "info");
    return true;
  }

  function reconcilePendingPr(pr: WatchedPr): void {
    const key = prIdentityKey(pr);
    const pending = state.pendingPrUpdates.find((candidate) => prIdentityKey(candidate.pr) === key);
    if (!pending) return;
    if (pending.checksHeadSha !== pr.headSha) {
      pending.checksHeadSha = undefined;
      pending.checksKey = undefined;
    }
    pending.pr = structuredClone(pr);
    removeEmptyPendingPr(pr);
  }

  function removePr(pr: Pick<WatchedPr, "repo" | "number">): void {
    const key = prIdentityKey(pr);
    state.watchedPrs = state.watchedPrs.filter((candidate) => prIdentityKey(candidate.pr) !== key);
    state.pendingPrUpdates = state.pendingPrUpdates.filter((candidate) => prIdentityKey(candidate.pr) !== key);
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

  async function fetchChecks(watched: WatchedPrState, ctx: ExtensionContext): Promise<Check[] | undefined> {
    return execJson<Check[]>("gh", [
      "pr",
      "checks",
      watched.pr.url,
      "--json",
      "name,state,bucket,workflow,link,completedAt",
    ], ctx);
  }

  async function fetchRunsForSha(ctx: ExtensionContext): Promise<WorkflowRun[] | undefined> {
    if (!state.watchedSha) return undefined;
    return execJson<WorkflowRun[]>("gh", [
      "run",
      "list",
      "--commit",
      state.watchedSha.sha,
      "--json",
      "databaseId,name,workflowName,status,conclusion,url,createdAt,updatedAt",
    ], ctx);
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

  function isFailingCheck(check: Check): boolean {
    const stateValue = (check.state ?? "").toLowerCase();
    const bucketValue = (check.bucket ?? "").toLowerCase();
    return [stateValue, bucketValue].some((value) =>
      ["fail", "failure", "cancel", "cancelled", "timed_out", "action_required", "startup_failure"].includes(value),
    );
  }

  function checksAreNotifiable(checks: Check[]): boolean {
    const allChecksTerminal = checks.length > 0 && checks.every(isTerminalCheck);
    return allChecksTerminal && (!state.orchestrationSessionId || !checks.some(isFailingCheck));
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
    if (checks) {
      const checksKey = checksCompletionKey(watched.pr.headSha, checks);
      const checksNotifiable = checksAreNotifiable(checks);
      const pending = state.pendingPrUpdates.find(
        (candidate) => prIdentityKey(candidate.pr) === prIdentityKey(watched.pr),
      );
      if (pending?.checksKey && (!checksNotifiable || pending.checksKey !== checksKey)) {
        pending.checksHeadSha = undefined;
        pending.checksKey = undefined;
        removeEmptyPendingPr(watched.pr);
      }
      if (state.orchestrationSessionId && checksNotifiable && watched.notifiedChecksKey !== checksKey) {
        watched.notifiedChecksKey = checksKey;
        const pendingUpdate = pendingPr(watched);
        pendingUpdate.checksHeadSha = watched.pr.headSha;
        pendingUpdate.checksKey = checksKey;
      } else {
        watched.notifiedChecksKey = checksNotifiable ? checksKey : undefined;
      }
    }
    watched.seenActivityIds = ((await fetchActivities(watched, ctx)) ?? []).map((activity) => activity.id);
  }

  async function baselineCurrentShaState(ctx: ExtensionContext): Promise<void> {
    if (!state.watchedSha) return;
    const runs = await fetchRunsForSha(ctx);
    if (!runs) return;
    const runsKey = runsCompletionKey(state.watchedSha.sha, runs);
    const allRunsTerminal = runs.length > 0 && runs.every(isTerminalRun);
    state.watchedSha.notifiedChecksKey = allRunsTerminal ? runsKey : undefined;
    if (state.pendingShaUpdate && (!allRunsTerminal || state.pendingShaUpdate.runsKey !== runsKey)) {
      state.pendingShaUpdate = undefined;
    }
  }

  async function fetchActivities(watched: WatchedPrState, ctx: ExtensionContext): Promise<TrackedActivity[] | undefined> {
    const { repo, number } = watched.pr;
    const [issueComments, reviews, reviewComments] = await Promise.all([
      execJson<Activity[]>("gh", ["api", `repos/${repo}/issues/${number}/comments?per_page=100`], ctx),
      execJson<Activity[]>("gh", ["api", `repos/${repo}/pulls/${number}/reviews?per_page=100`], ctx),
      execJson<Activity[]>("gh", ["api", `repos/${repo}/pulls/${number}/comments?per_page=100`], ctx),
    ]);
    if (!issueComments || !reviews || !reviewComments) return undefined;

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

    if (state.orchestrationSessionId) {
      return `CI finished for worker PR #${watched.pr.number}.\n\n${watched.pr.url}`;
    }

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

    if (state.orchestrationSessionId) {
      return `New activity on worker PR #${watched.pr.number}:\n${activityList}\n\n${watched.pr.url}`;
    }

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

  function pendingPr(watched: WatchedPrState): PendingPrUpdate {
    const key = prIdentityKey(watched.pr);
    let pending = state.pendingPrUpdates.find((candidate) => prIdentityKey(candidate.pr) === key);
    if (!pending) {
      pending = { pr: structuredClone(watched.pr), feedbackActivities: [] };
      state.pendingPrUpdates.push(pending);
    } else {
      pending.pr = structuredClone(watched.pr);
    }
    return pending;
  }

  function removeEmptyPendingPr(pr: Pick<WatchedPr, "repo" | "number">): void {
    const key = prIdentityKey(pr);
    state.pendingPrUpdates = state.pendingPrUpdates.filter(
      (pending) =>
        prIdentityKey(pending.pr) !== key ||
        Boolean(pending.checksKey) ||
        Boolean(pending.conflictsKey) ||
        pending.feedbackActivities.length > 0,
    );
  }

  function clearPendingConflict(pr: Pick<WatchedPr, "repo" | "number">): void {
    const key = prIdentityKey(pr);
    const pending = state.pendingPrUpdates.find((candidate) => prIdentityKey(candidate.pr) === key);
    if (!pending?.conflictsKey) return;
    pending.conflictsKey = undefined;
    removeEmptyPendingPr(pr);
  }

  function buildPrConflictsMessage(watched: WatchedPrState): string {
    const details = `Branch: ${watched.pr.branch}\nPR: ${watched.pr.url}`;
    if (prWatchMode(watched) === "author") {
      return `PR #${watched.pr.number} now has merge conflicts that need to be resolved.\n\nUse repos to resolve the conflicts, then push the resolved branch.\n\n${details}`;
    }
    return `PR #${watched.pr.number} now has merge conflicts.\n\n${reviewerSafetyNotice(watched)}\n\nInspect the conflict status as reviewer context and summarize the follow-up needed; do not resolve or push the conflicts yourself.\n\n${details}`;
  }

  function buildShaChecksMessage(pending: PendingShaUpdate): string {
    return `CI finished for SHA ${pending.sha.slice(0, 7)}.\n\nPlease inspect the workflow runs/results with gh, determine whether anything needs to be fixed, and take appropriate action. If they failed, diagnose and fix them.\n\nA passing run is not sufficient on its own. If any run involves a generated diff (e.g. a "diff", "codegen", "inferred types", "snapshot", or "generated files" step), do not treat a green result as done: fetch and read the actual diff/output from that step (e.g. \`gh run view\`, the run logs, or the committed generated files) and verify the generated changes match the changes you intended. Confirm there are no unintended or surprising changes (e.g. unexpected inferred-type or schema changes) before closing the loop. If the diff contains anything you did not intend, treat it as a problem to investigate and fix rather than a pass.\n\nOnce you have confirmed the runs passed AND any generated diffs are correct and intentional, briefly summarize that.\n\nRepo: ${pending.repo}\nSHA: ${pending.sha}`;
  }

  function buildPendingMessage(
    pendingPrUpdates: PendingPrUpdate[],
    pendingShaUpdate: PendingShaUpdate | undefined,
  ): string {
    const messages: string[] = [];
    for (const pending of pendingPrUpdates) {
      const watched: WatchedPrState = { pr: pending.pr, seenActivityIds: [] };
      if (pending.checksKey) messages.push(buildPrChecksMessage(watched));
      if (pending.conflictsKey) messages.push(buildPrConflictsMessage(watched));
      if (pending.feedbackActivities.length > 0) {
        messages.push(buildPrFeedbackMessage(watched, pending.feedbackActivities));
      }
    }
    if (pendingShaUpdate) messages.push(buildShaChecksMessage(pendingShaUpdate));
    return buildBatchMessage(messages);
  }

  function deliveryMarker(id: string): string {
    return `<!-- pr-watch-delivery:${id} -->`;
  }

  function sessionHasDelivery(ctx: ExtensionContext, delivery: PendingDelivery): boolean {
    const marker = deliveryMarker(delivery.id);
    return ctx.sessionManager.getBranch().some((entry) => {
      if (entry.type !== "message" || entry.message.role !== "user") return false;
      const content = Array.isArray(entry.message.content) ? entry.message.content : [];
      return textContent(content).includes(marker);
    });
  }

  function deliveryStillPending(delivery: PendingDelivery): boolean {
    for (const delivered of delivery.pendingPrUpdates) {
      const pending = state.pendingPrUpdates.find(
        (candidate) => prIdentityKey(candidate.pr) === prIdentityKey(delivered.pr),
      );
      if (!pending) return false;
      if (delivered.checksKey && pending.checksKey !== delivered.checksKey) return false;
      if (delivered.conflictsKey && pending.conflictsKey !== delivered.conflictsKey) return false;
      const pendingActivityIds = new Set(pending.feedbackActivities.map((activity) => activity.id));
      if (delivered.feedbackActivities.some((activity) => !pendingActivityIds.has(activity.id))) return false;
    }
    if (delivery.pendingShaUpdate) {
      if (
        state.pendingShaUpdate?.repo !== delivery.pendingShaUpdate.repo ||
        state.pendingShaUpdate.sha !== delivery.pendingShaUpdate.sha ||
        state.pendingShaUpdate.runsKey !== delivery.pendingShaUpdate.runsKey
      ) {
        return false;
      }
    }
    return true;
  }

  function flushPending(ctx: ExtensionContext): void {
    if (state.mode !== "active" || !ctx.isIdle()) return;
    if (state.pendingDelivery && !deliveryAttemptedId && !deliveryStillPending(state.pendingDelivery)) {
      state.pendingDelivery = undefined;
      save();
    }
    if (pendingCount() === 0) return;

    if (!state.pendingDelivery) {
      const id = randomUUID();
      const pendingPrUpdates = structuredClone(state.pendingPrUpdates);
      const pendingShaUpdate = structuredClone(state.pendingShaUpdate);
      state.pendingDelivery = {
        id,
        message: `${buildPendingMessage(pendingPrUpdates, pendingShaUpdate)}\n\n${deliveryMarker(id)}`,
        pendingPrUpdates,
        pendingShaUpdate,
      };
      save();
    }
    if (deliveryAttemptedId === state.pendingDelivery.id) return;

    deliveryAttemptedId = state.pendingDelivery.id;
    try {
      pi.sendUserMessage(state.pendingDelivery.message);
    } catch (error) {
      deliveryAttemptedId = undefined;
      state.lastError = error instanceof Error ? error.message : String(error);
      save();
      setStatus(ctx);
    }
  }

  function acknowledgeDelivery(ctx: ExtensionContext): void {
    const delivery = state.pendingDelivery;
    if (!delivery) return;

    for (const delivered of delivery.pendingPrUpdates) {
      const pending = state.pendingPrUpdates.find(
        (candidate) => prIdentityKey(candidate.pr) === prIdentityKey(delivered.pr),
      );
      if (!pending) continue;
      if (delivered.checksKey && pending.checksKey === delivered.checksKey) {
        pending.checksHeadSha = undefined;
        pending.checksKey = undefined;
      }
      if (delivered.conflictsKey && pending.conflictsKey === delivered.conflictsKey) {
        pending.conflictsKey = undefined;
      }
      const deliveredActivityIds = new Set(delivered.feedbackActivities.map((activity) => activity.id));
      pending.feedbackActivities = pending.feedbackActivities.filter((activity) => !deliveredActivityIds.has(activity.id));
      removeEmptyPendingPr(delivered.pr);
    }

    if (
      delivery.pendingShaUpdate &&
      state.pendingShaUpdate?.repo === delivery.pendingShaUpdate.repo &&
      state.pendingShaUpdate.sha === delivery.pendingShaUpdate.sha &&
      state.pendingShaUpdate.runsKey === delivery.pendingShaUpdate.runsKey
    ) {
      state.pendingShaUpdate = undefined;
    }

    state.pendingDelivery = undefined;
    deliveryAttemptedId = undefined;
    state.lastNotifyAt = Date.now();
    save();
    setStatus(ctx);
  }

  function reconcileDelivery(ctx: ExtensionContext): void {
    if (!state.pendingDelivery) return;
    if (sessionHasDelivery(ctx, state.pendingDelivery)) {
      acknowledgeDelivery(ctx);
    } else if (deliveryAttemptedId && ctx.isIdle()) {
      deliveryAttemptedId = undefined;
    }
  }

  async function pollPr(watched: WatchedPrState, ctx: ExtensionContext): Promise<PrPollResult> {
    const latest = await execJson<{
      headRefOid: string;
      headRefName?: string;
      state: string;
      author?: { login?: string };
      mergeable?: string;
    }>("gh", ["pr", "view", watched.pr.url, "--json", "headRefOid,headRefName,state,author,mergeable"], ctx);

    if (!latest) return { addedCount: 0, error: `Could not refresh watched PR ${watched.pr.url}` };
    if (latest.state !== "OPEN") return { addedCount: 0, remove: true };

    if (latest.author?.login) watched.pr.authorLogin = latest.author.login;
    if (latest.headRefName) watched.pr.branch = latest.headRefName;

    let addedCount = 0;
    if (isDefinitiveMergeable(latest.mergeable)) {
      if (
        !state.orchestrationSessionId &&
        watched.mergeable === "MERGEABLE" &&
        latest.mergeable === "CONFLICTING"
      ) {
        pendingPr(watched).conflictsKey = randomUUID();
        addedCount += 1;
      } else if (latest.mergeable === "MERGEABLE") {
        clearPendingConflict(watched.pr);
      }
      watched.mergeable = latest.mergeable;
    }

    if (latest.headRefOid !== watched.pr.headSha) {
      watched.pr.headSha = latest.headRefOid;
      watched.notifiedChecksKey = undefined;
      const pending = state.pendingPrUpdates.find(
        (candidate) => prIdentityKey(candidate.pr) === prIdentityKey(watched.pr),
      );
      if (pending) {
        pending.checksHeadSha = undefined;
        pending.checksKey = undefined;
      }
      removeEmptyPendingPr(watched.pr);
    }

    const checks = await fetchChecks(watched, ctx);
    if (checks) {
      const checksNotifiable = checksAreNotifiable(checks);
      const checksKey = checksCompletionKey(watched.pr.headSha, checks);
      const pending = state.pendingPrUpdates.find(
        (candidate) => prIdentityKey(candidate.pr) === prIdentityKey(watched.pr),
      );
      if (pending?.checksKey && (!checksNotifiable || pending.checksKey !== checksKey)) {
        pending.checksHeadSha = undefined;
        pending.checksKey = undefined;
        removeEmptyPendingPr(watched.pr);
      }
      if (checksNotifiable && watched.notifiedChecksKey !== checksKey) {
        watched.notifiedChecksKey = checksKey;
        const pendingUpdate = pendingPr(watched);
        pendingUpdate.checksHeadSha = watched.pr.headSha;
        pendingUpdate.checksKey = checksKey;
        addedCount += 1;
      }
    }

    const currentActivities = await fetchActivities(watched, ctx);
    if (!currentActivities) return { addedCount };
    const currentActivityIds = currentActivities.map((activity) => activity.id);
    const currentActivityIdSet = new Set(currentActivityIds);
    const existingPending = state.pendingPrUpdates.find(
      (candidate) => prIdentityKey(candidate.pr) === prIdentityKey(watched.pr),
    );
    if (existingPending) {
      existingPending.pr = structuredClone(watched.pr);
      existingPending.feedbackActivities = existingPending.feedbackActivities.filter((activity) =>
        currentActivityIdSet.has(activity.id),
      );
      removeEmptyPendingPr(watched.pr);
    }

    const seen = new Set(watched.seenActivityIds);
    const newActivities = currentActivities.filter((activity) => !seen.has(activity.id));
    const triggeringActivities = newActivities.filter((activity) => !isSuppressedSelfActivity(activity));
    if (triggeringActivities.length > 0) {
      const pending = pendingPr(watched);
      const pendingIds = new Set(pending.feedbackActivities.map((activity) => activity.id));
      const uniqueActivities = triggeringActivities.filter((activity) => !pendingIds.has(activity.id));
      pending.feedbackActivities.push(...uniqueActivities);
      addedCount += uniqueActivities.length;
    }

    watched.seenActivityIds = Array.from(new Set([...watched.seenActivityIds, ...currentActivityIds]));
    return { addedCount };
  }

  async function poll(ctx: ExtensionContext): Promise<void> {
    if (polling || state.mode === "off" || !hasTargets()) return;
    polling = true;

    try {
      reconcileDelivery(ctx);
      await refreshSelfLogin(ctx);
      let addedCount = 0;
      const errors = await reconcileOrchestrationMembership(ctx);

      for (const watched of [...state.watchedPrs]) {
        try {
          const result = await pollPr(watched, ctx);
          addedCount += result.addedCount;
          if (result.error) errors.push(result.error);
          if (result.remove) removePr(watched.pr);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      addedCount += await pollSha(ctx);
      state.lastPollAt = Date.now();
      state.lastError = errors.length > 0 ? errors.join("; ") : undefined;
      if (!hasTargets()) stopPolling(ctx);
      save();
      await publishWorkerSnapshot(ctx);
      setStatus(ctx);

      if (addedCount > 0) {
        ctx.ui.notify(`PR Watch buffered ${addedCount} update${addedCount === 1 ? "" : "s"} (${pendingCount()} pending).`, "info");
      }
      flushPending(ctx);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      save();
    } finally {
      polling = false;
    }
  }

  async function pollSha(ctx: ExtensionContext): Promise<number> {
    if (!state.watchedSha) return 0;

    const runs = await fetchRunsForSha(ctx);
    if (!runs) return 0;
    const allRunsTerminal = runs.length > 0 && runs.every(isTerminalRun);
    const runsKey = runsCompletionKey(state.watchedSha.sha, runs);
    if (state.pendingShaUpdate && (!allRunsTerminal || state.pendingShaUpdate.runsKey !== runsKey)) {
      state.pendingShaUpdate = undefined;
    }
    if (!allRunsTerminal || state.watchedSha.notifiedChecksKey === runsKey) return 0;

    state.watchedSha.notifiedChecksKey = runsKey;
    state.pendingShaUpdate = { repo: state.watchedSha.repo, sha: state.watchedSha.sha, runsKey };
    return 1;
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

  pi.on("session_start", async (event, ctx) => {
    state = initialState();
    deliveryAttemptedId = undefined;
    lastPublishedMembership = undefined;
    const requestedOrchestrationSessionId = process.env.PI_ORCHESTRATION_SESSION_ID?.trim() || undefined;
    const requestedWorkerOrchestrationSessionId = process.env[WORKER_ORCHESTRATION_ENV]?.trim() || undefined;
    delete process.env[WORKER_ORCHESTRATION_ENV];
    const savedEntry = [...ctx.sessionManager.getBranch()]
      .reverse()
      .find((entry) => entry.type === "custom" && entry.customType === CUSTOM_STATE);
    if (savedEntry?.type === "custom" && isWatchState(savedEntry.data)) {
      state = structuredClone(savedEntry.data);
      if (event.reason === "startup" && requestedOrchestrationSessionId && !state.orchestrationSessionId) {
        state = initialState();
        state.orchestrationSessionId = requestedOrchestrationSessionId;
      } else if (
        event.reason === "startup" &&
        requestedWorkerOrchestrationSessionId &&
        !state.orchestrationSessionId &&
        !state.workerOrchestrationSessionId
      ) {
        state = initialState();
        state.workerOrchestrationSessionId = requestedWorkerOrchestrationSessionId;
      }
    } else if (event.reason === "startup") {
      state.orchestrationSessionId = requestedOrchestrationSessionId;
      if (!state.orchestrationSessionId) {
        state.workerOrchestrationSessionId = requestedWorkerOrchestrationSessionId;
      }
    }
    if (state.orchestrationSessionId) {
      process.env.PI_ORCHESTRATION_SESSION_ID = state.orchestrationSessionId;
    } else {
      delete process.env.PI_ORCHESTRATION_SESSION_ID;
    }
    reconcileDelivery(ctx);

    if (state.mode === "off") {
      save();
      await publishWorkerSnapshot(ctx, true);
      setStatus(ctx);
      flushPending(ctx);
      return;
    }

    const savedPrs = [...state.watchedPrs];
    const savedSha = state.watchedSha;
    state.watchedSha = undefined;
    for (const watched of savedPrs) await discover(ctx, "startup", false, watched.pr.url, true);
    const reconciliationErrors = await reconcileOrchestrationMembership(ctx);

    if (!state.orchestrationSessionId && state.watchedPrs.length === 0 && savedSha) {
      state.watchedSha = { repo: savedSha.repo, sha: savedSha.sha };
      await baselineCurrentShaState(ctx);
    }

    state.lastError = reconciliationErrors.length > 0 ? reconciliationErrors.join("; ") : state.lastError;
    save();
    await publishWorkerSnapshot(ctx, true);
    startPolling(ctx);
    setStatus(ctx);
    flushPending(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  pi.on("agent_settled", async (_event, ctx) => {
    reconcileDelivery(ctx);
    flushPending(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    reconcileDelivery(ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (state.mode === "off" || !isBashToolResultLike(event) || event.isError) return;
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

      if (action === "on" || action === "resume") {
        state.mode = "active";
        save();
        if (hasTargets()) {
          if (state.watchedPrs.length > 0) await ensureCurrentRepo(ctx);
          startPolling(ctx);
          await poll(ctx);
        } else {
          await discover(ctx, `manual ${action}`);
          flushPending(ctx);
        }
        setStatus(ctx);
        ctx.ui.notify(`PR watch ${action === "on" ? "enabled" : "resumed"}.`, "info");
        return;
      }

      if (action === "pause") {
        state.mode = "paused";
        save();
        startPolling(ctx);
        setStatus(ctx);
        ctx.ui.notify("PR watch notifications paused; polling continues.", "info");
        return;
      }

      if (action === "off") {
        state.mode = "off";
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
        state.mode = "active";
        save();
        await discover(ctx, "manual add", true, target);
        flushPending(ctx);
        return;
      }

      if (action === "remove") {
        const number = Number(target.match(/\d+$/)?.[0]);
        if (!Number.isInteger(number) || number <= 0) {
          ctx.ui.notify("Usage: /pr-watch remove <number-or-url>", "warning");
          return;
        }
        const repo = repositoryFromPrUrl(target);
        const watched = state.watchedPrs.find(
          (candidate) => candidate.pr.number === number && (!repo || candidate.pr.repo.toLowerCase() === repo.toLowerCase()),
        );
        const existed = Boolean(watched);
        if (watched) removePr(watched.pr);
        if (!hasTargets()) stopPolling(ctx);
        save();
        await publishWorkerSnapshot(ctx);
        setStatus(ctx);
        ctx.ui.notify(existed ? `Removed PR #${number} from PR watch.` : `PR #${number} was not being watched.`, "info");
        return;
      }

      if (action === "reset") {
        stopPolling(ctx);
        const orchestrationSessionId = state.orchestrationSessionId;
        const workerOrchestrationSessionId = state.workerOrchestrationSessionId;
        state = initialState();
        state.orchestrationSessionId = orchestrationSessionId;
        state.workerOrchestrationSessionId = workerOrchestrationSessionId;
        save();
        if (state.orchestrationSessionId) {
          await reconcileOrchestrationMembership(ctx);
          startPolling(ctx);
        } else {
          await discover(ctx, "manual reset");
          await publishWorkerSnapshot(ctx);
        }
        return;
      }

      if (action !== "status") {
        ctx.ui.notify("Usage: /pr-watch [status|on|off|pause|resume|add <number-or-url>|remove <number-or-url>|reset]", "warning");
        return;
      }

      const watchedPrs =
        state.watchedPrs.length > 0
          ? state.watchedPrs
              .map(
                ({ pr, seenActivityIds }) =>
                  `PR ${pr.repo}#${pr.number} ${pr.url}\n  branch: ${pr.branch}\n  head: ${pr.headSha}\n  author: ${pr.authorLogin ?? "unknown"}\n  watch mode: ${prWatchMode({ pr, seenActivityIds })}\n  seen activity: ${seenActivityIds.length}`,
              )
              .join("\n")
          : "none";
      const watchedSha = state.watchedSha
        ? `SHA ${state.watchedSha.sha}\nrepo: ${state.watchedSha.repo}`
        : "none";
      const pendingSummary = [
        ...state.pendingPrUpdates.map((pending) => {
          const updates = [
            pending.checksKey ? "CI complete" : undefined,
            pending.conflictsKey ? "merge conflicts" : undefined,
            pending.feedbackActivities.length > 0
              ? `${pending.feedbackActivities.length} feedback item${pending.feedbackActivities.length === 1 ? "" : "s"}`
              : undefined,
          ].filter(Boolean);
          return `  PR ${pending.pr.repo}#${pending.pr.number}: ${updates.join(", ")}`;
        }),
        ...(state.pendingShaUpdate ? [`  SHA ${state.pendingShaUpdate.sha.slice(0, 7)}: CI complete`] : []),
      ];
      const lines = [
        `PR watch mode: ${state.mode}`,
        `pending updates: ${pendingCount()}`,
        ...(pendingSummary.length > 0 ? pendingSummary : []),
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
