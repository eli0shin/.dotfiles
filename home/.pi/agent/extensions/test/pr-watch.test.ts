import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import prWatch, {
  prIdentityKey,
  prStatusIdentity,
  pullRequestUrlFromText,
  shouldTrackActivity,
} from "../pr-watch.ts";

const humanActivity = { id: 1, user: { login: "reviewer", type: "User" } };
const botActivity = { id: 2, user: { login: "review-bot[bot]", type: "Bot" } };
const codexActivity = { id: 3, user: { login: "chatgpt-codex-connector[bot]", type: "Bot" } };
const pr104Url = "https://github.com/eli0shin/repos/pull/104";
const pr105Url = "https://github.com/eli0shin/repos/pull/105";

type PrFixture = {
  number: number;
  url: string;
  branch: string;
  headSha: string;
  state: string;
  authorLogin: string;
  headRepo: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
};

function createHarness() {
  const stateRoot = mkdtempSync(join(tmpdir(), "pr-watch-test-"));
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  const execCalls: Array<{ command: string; args: string[] }> = [];
  const sentMessages: string[] = [];
  const sentMessageOptions: unknown[] = [];
  const savedStates: any[] = [];
  const notifications: string[] = [];
  const statuses: Array<string | undefined> = [];
  const reviews = new Map<number, unknown[]>();
  const checks = new Map<number, unknown[]>();
  const runs: unknown[] = [];
  const unavailablePrs = new Set<number>();
  const prs = new Map<number, PrFixture>([
    [
      104,
      {
        number: 104,
        url: pr104Url,
        branch: "remove-collapse-command",
        headSha: "abc104",
        state: "OPEN",
        authorLogin: "eli0shin",
        headRepo: "eli0shin/repos",
        mergeable: "MERGEABLE",
      },
    ],
    [
      105,
      {
        number: 105,
        url: pr105Url,
        branch: "second-feature",
        headSha: "abc105",
        state: "OPEN",
        authorLogin: "eli0shin",
        headRepo: "eli0shin/repos",
        mergeable: "MERGEABLE",
      },
    ],
  ]);
  let intervalCallback: (() => unknown) | undefined;
  let idle = true;
  let branchEntries: unknown[] = [];
  let currentBranch = "main";
  let localSha = "main-sha";
  let remoteBranchSha = "main-sha";
  let repoAvailable = true;
  let shaAvailable = true;
  let branchTipAvailable = true;
  let runsAvailable = true;

  function prNumberFromArgs(args: string[]): number | undefined {
    for (const arg of args) {
      const match = arg.match(/(?:pull\/)?(\d+)$/);
      if (match) return Number(match[1]);
    }
    return undefined;
  }

  process.env.PI_PR_WATCH_STATE_DIR = stateRoot;
  prWatch({
    on(eventName: string, handler: (event: any, ctx: any) => Promise<void>): void {
      handlers.set(eventName, handler);
    },
    registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> }): void {
      commands.set(name, command);
    },
    appendEntry(_customType: string, data: unknown): void {
      savedStates.push(structuredClone(data));
    },
    sendUserMessage(message: string, options?: unknown): void {
      sentMessages.push(message);
      sentMessageOptions.push(options);
      branchEntries.push({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: message }] },
      });
      void handlers.get("turn_start")?.({}, ctx);
    },
    async exec(command: string, args: string[]) {
      execCalls.push({ command, args });
      if (command === "gh" && args[0] === "repo") {
        return repoAvailable
          ? { code: 0, stdout: JSON.stringify({ nameWithOwner: "eli0shin/repos" }), stderr: "" }
          : { code: 1, stdout: "", stderr: "temporary failure" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "view") {
        const number = prNumberFromArgs(args) ?? -1;
        const pr = prs.get(number);
        if (!pr || unavailablePrs.has(number)) {
          return { code: 1, stdout: "", stderr: "no pull request found" };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            number: pr.number,
            url: pr.url,
            headRefName: pr.branch,
            headRefOid: pr.headSha,
            state: pr.state,
            author: { login: pr.authorLogin },
            headRepository: { nameWithOwner: pr.headRepo },
            mergeable: pr.mergeable,
          }),
          stderr: "",
        };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
        return { code: 0, stdout: JSON.stringify(checks.get(prNumberFromArgs(args) ?? -1) ?? []), stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "user") {
        return { code: 0, stdout: JSON.stringify({ login: "eli0shin" }), stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && args[1]?.startsWith("repos/eli0shin/repos/commits/")) {
        return shaAvailable && branchTipAvailable
          ? { code: 0, stdout: JSON.stringify({ sha: remoteBranchSha }), stderr: "" }
          : { code: 1, stdout: "", stderr: "temporary failure" };
      }
      if (command === "gh" && args[0] === "api") {
        const number = Number(args[1]?.match(/\/(\d+)\//)?.[1]);
        const payload = args[1]?.includes("/reviews") ? reviews.get(number) ?? [] : [];
        return { code: 0, stdout: JSON.stringify(payload), stderr: "" };
      }
      if (command === "git" && args[0] === "branch" && args[1] === "--show-current") {
        return shaAvailable
          ? { code: 0, stdout: `${currentBranch}\n`, stderr: "" }
          : { code: 1, stdout: "", stderr: "temporary failure" };
      }
      if (command === "git" && args[0] === "rev-parse") {
        return shaAvailable
          ? { code: 0, stdout: `${localSha}\n`, stderr: "" }
          : { code: 1, stdout: "", stderr: "temporary failure" };
      }
      if (command === "gh" && args[0] === "run") {
        return runsAvailable
          ? { code: 0, stdout: JSON.stringify(runs), stderr: "" }
          : { code: 1, stdout: "", stderr: "temporary failure" };
      }
      return { code: 1, stdout: "", stderr: "unsupported command" };
    },
  } as any);

  const ctx = {
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      notify(message: string): void {
        notifications.push(message);
      },
      setStatus(_key: string, text: string | undefined): void {
        statuses.push(text);
      },
    },
    isIdle: () => idle,
    sessionManager: {
      getBranch: () => branchEntries,
      getSessionId: () => "worker-session",
    },
  };

  async function withFakeTimer<T>(action: () => Promise<T> | T): Promise<T> {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((callback: () => unknown) => {
      intervalCallback = callback;
      return { fake: true };
    }) as any;
    globalThis.clearInterval = (() => {}) as any;
    try {
      return await action();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  }

  async function activate(number: number, subcommand = "create"): Promise<void> {
    const url = prs.get(number)?.url;
    assert.ok(url);
    await withFakeTimer(() =>
      handlers.get("tool_result")?.(
        {
          toolName: "bash",
          input: { command: `cd /tmp/repos-${number} && gh pr ${subcommand}` },
          content: [{ type: "text", text: `${url}\n` }],
        },
        ctx,
      ),
    );
  }

  async function push(): Promise<void> {
    await withFakeTimer(() =>
      handlers.get("tool_result")?.(
        {
          toolName: "bash",
          input: { command: "git push" },
          content: [{ type: "text", text: "main -> main" }],
        },
        ctx,
      ),
    );
  }

  async function merge(): Promise<void> {
    await withFakeTimer(() =>
      handlers.get("tool_result")?.(
        {
          toolName: "bash",
          input: { command: "gh pr merge --squash --delete-branch" },
          content: [{ type: "text", text: "Merged pull request\n" }],
        },
        ctx,
      ),
    );
  }

  async function rerun(): Promise<void> {
    await withFakeTimer(() =>
      handlers.get("tool_result")?.(
        {
          toolName: "bash",
          input: { command: "gh run rerun --failed" },
          content: [{ type: "text", text: "Requested rerun\n" }],
        },
        ctx,
      ),
    );
  }

  async function runPoll(): Promise<void> {
    assert.ok(intervalCallback, "polling interval was not registered");
    await withFakeTimer(() => intervalCallback?.());
  }

  async function writeWorkerSnapshot(
    orchestrationId: string,
    workerSessionId: string,
    numbers: number[],
    settlement?: {
      branch: string;
      assistantEntryId: string;
      response: string;
      hadWatchedPr: boolean;
    },
  ): Promise<string> {
    const directory = join(stateRoot, encodeURIComponent(orchestrationId));
    await mkdir(directory, { recursive: true });
    const watchedPrs = numbers.map((number) => {
      const pr = prs.get(number);
      assert.ok(pr);
      const repo = new URL(pr.url).pathname.split("/").filter(Boolean).slice(0, 2).join("/");
      return { repo, number: pr.number, url: pr.url };
    });
    const path = join(directory, `${encodeURIComponent(workerSessionId)}.json`);
    await writeFile(
      path,
      JSON.stringify(
        {
          version: 2,
          orchestrationId,
          workerSessionId,
          revision: Date.now(),
          branch: settlement?.branch ?? `branch-${workerSessionId}`,
          watchedPrs,
          ...(settlement
            ? {
                latestSettlement: {
                  assistantEntryId: settlement.assistantEntryId,
                  response: settlement.response,
                  hadWatchedPr: settlement.hadWatchedPr,
                },
              }
            : {}),
        },
      ),
    );
    return path;
  }

  async function startSession(reason = "startup"): Promise<void> {
    await withFakeTimer(() => handlers.get("session_start")?.({ reason }, ctx));
  }

  async function settleAgent(): Promise<void> {
    await handlers.get("agent_settled")?.({}, ctx);
  }

  async function shutdown(): Promise<void> {
    await handlers.get("session_shutdown")?.({}, ctx);
  }

  return {
    handlers,
    commands,
    execCalls,
    sentMessages,
    sentMessageOptions,
    savedStates,
    notifications,
    statuses,
    reviews,
    checks,
    runs,
    prs,
    unavailablePrs,
    ctx,
    activate,
    push,
    merge,
    rerun,
    runPoll,
    startSession,
    settleAgent,
    shutdown,
    writeWorkerSnapshot,
    async readWorkerSnapshot(orchestrationId: string, workerSessionId: string): Promise<any> {
      const path = join(stateRoot, encodeURIComponent(orchestrationId), `${encodeURIComponent(workerSessionId)}.json`);
      return JSON.parse(await readFile(path, "utf8"));
    },
    async corruptWorkerSnapshot(orchestrationId: string, workerSessionId: string): Promise<void> {
      const path = join(stateRoot, encodeURIComponent(orchestrationId), `${encodeURIComponent(workerSessionId)}.json`);
      await writeFile(path, "{corrupt");
    },
    setIdle(value: boolean) {
      idle = value;
    },
    setBranchEntries(entries: unknown[]) {
      branchEntries = entries;
    },
    setCurrentSha(sha: string) {
      remoteBranchSha = sha;
    },
    setCurrentBranch(branch: string) {
      currentBranch = branch;
    },
    setLocalSha(sha: string) {
      localSha = sha;
    },
    setCurrentTargetAvailable(value: boolean) {
      repoAvailable = value;
      shaAvailable = value;
    },
    setBranchTipAvailable(value: boolean) {
      branchTipAvailable = value;
    },
    setRunsAvailable(value: boolean) {
      runsAvailable = value;
    },
  };
}

function terminalCheck(name: string) {
  return {
    name,
    state: "SUCCESS",
    bucket: "pass",
    workflow: "CI",
    link: `https://github.com/eli0shin/repos/actions/runs/${name}`,
    completedAt: "2026-07-13T22:00:00Z",
  };
}

function failingCheck(name: string) {
  return {
    ...terminalCheck(name),
    state: "FAILURE",
    bucket: "fail",
  };
}

test("tracks human feedback of every activity kind", () => {
  assert.equal(shouldTrackActivity("issue-comment", humanActivity), true);
  assert.equal(shouldTrackActivity("review", humanActivity), true);
  assert.equal(shouldTrackActivity("review-comment", humanActivity), true);
});

test("ignores general PR comments from bots", () => {
  assert.equal(shouldTrackActivity("issue-comment", botActivity), false);
  assert.equal(
    shouldTrackActivity("issue-comment", { id: 3, author: { login: "automation", is_bot: true } }),
    false,
  );
  assert.equal(shouldTrackActivity("issue-comment", { id: 4, user: { login: "automation[bot]" } }), false);
});

test("tracks reviews and inline review comments from bots", () => {
  assert.equal(shouldTrackActivity("review", botActivity), true);
  assert.equal(shouldTrackActivity("review-comment", botActivity), true);
});

test("orchestration ignores reviews and inline review comments from configured authors", () => {
  assert.equal(shouldTrackActivity("review", codexActivity, true), false);
  assert.equal(shouldTrackActivity("review-comment", codexActivity, true), false);
  assert.equal(shouldTrackActivity("review", codexActivity), true);
  assert.equal(shouldTrackActivity("review", botActivity, true), true);
});

test("ignores activities without an id", () => {
  assert.equal(shouldTrackActivity("issue-comment", { user: { login: "reviewer" } }), false);
  assert.equal(shouldTrackActivity("review", { user: { login: "review-bot[bot]" } }), false);
  assert.equal(shouldTrackActivity("review-comment", {}), false);
});

test("uses the last PR URL in command output", () => {
  assert.equal(pullRequestUrlFromText(`${pr104Url}\n${pr105Url}\n`), pr105Url);
});

test("PR identity includes the repository", () => {
  assert.notEqual(
    prIdentityKey({ repo: "owner/one", number: 42 }),
    prIdentityKey({ repo: "owner/two", number: 42 }),
  );
});

test("status identity omits the current repository and all organization prefixes", () => {
  assert.equal(prStatusIdentity({ repo: "owner/current", number: 42 }, "OWNER/CURRENT"), "#42");
  assert.equal(prStatusIdentity({ repo: "owner/other", number: 42 }, "owner/current"), "other#42");
  assert.equal(prStatusIdentity({ repo: "another/other", number: 42 }, undefined), "other#42");
});

test("status line prefixes only PRs from other repositories", async () => {
  const harness = createHarness();
  await harness.startSession();
  await harness.push();
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");

  await harness.activate(104);
  assert.equal(harness.statuses.at(-1), "PR watch: #104");

  harness.prs.get(105)!.url = "https://github.com/another/repository/pull/105";
  await harness.activate(105);

  assert.equal(harness.statuses.at(-1), "PR watch: #104, repository#105");
  await harness.shutdown();
});

test("associated workers publish ordinary PR watch membership regardless of local mode", async () => {
  const harness = createHarness();
  const original = process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
  process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = "session-123";

  try {
    await harness.startSession();
    await harness.push();
    assert.equal(process.env.PI_PARENT_ORCHESTRATION_SESSION_ID, undefined);
    assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
    assert.deepEqual(
      (await harness.readWorkerSnapshot("session-123", "worker-session")).watchedPrs,
      [],
    );

    await harness.activate(104);
    await harness.commands.get("pr-watch")?.handler("off", harness.ctx);

    assert.deepEqual(
      (await harness.readWorkerSnapshot("session-123", "worker-session")).watchedPrs,
      [{ repo: "eli0shin/repos", number: 104, url: pr104Url }],
    );
    assert.equal(harness.savedStates.at(-1)?.workerOrchestrationSessionId, "session-123");
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
    else process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = original;
  }
});

test("ordinary sessions do not publish worker snapshots", async () => {
  const harness = createHarness();
  delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
  await harness.startSession();
  await harness.push();
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
  await harness.activate(104);

  await assert.rejects(harness.readWorkerSnapshot("session-123", "worker-session"));
  await harness.shutdown();
});

test("associated workers publish their branch and terminal response when they settle without a PR", async () => {
  const harness = createHarness();
  const original = process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
  process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = "session-123";
  harness.setCurrentBranch("009-worker-recovery");
  harness.setBranchEntries([
    {
      type: "message",
      id: "assistant-final",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "I cannot start because a required credential is missing." },
        ],
        stopReason: "stop",
      },
    },
  ]);

  try {
    await harness.startSession();
    await harness.settleAgent();

    assert.deepEqual(await harness.readWorkerSnapshot("session-123", "worker-session"), {
      version: 2,
      orchestrationId: "session-123",
      workerSessionId: "worker-session",
      revision: (await harness.readWorkerSnapshot("session-123", "worker-session")).revision,
      branch: "009-worker-recovery",
      watchedPrs: [],
      latestSettlement: {
        assistantEntryId: "assistant-final",
        response: "I cannot start because a required credential is missing.",
        hadWatchedPr: false,
      },
    });
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
    else process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = original;
  }
});

test("associated workers publish terminal errors and record watched PR suppression", async () => {
  const harness = createHarness();
  const original = process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
  process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = "session-123";
  harness.setCurrentBranch("009-worker-recovery");

  try {
    await harness.startSession();
    await harness.activate(104);
    harness.setBranchEntries([
      {
        type: "message",
        id: "assistant-error",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "provider unavailable",
        },
      },
    ]);
    await harness.settleAgent();

    assert.deepEqual((await harness.readWorkerSnapshot("session-123", "worker-session")).latestSettlement, {
      assistantEntryId: "assistant-error",
      response: "provider unavailable",
      hadWatchedPr: true,
    });
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
    else process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = original;
  }
});

test("associated workers use an aborted response error as their last message", async () => {
  const harness = createHarness();
  const original = process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
  process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = "session-123";
  harness.setCurrentBranch("009-worker-recovery");
  harness.setBranchEntries([
    {
      type: "message",
      id: "assistant-aborted",
      message: {
        role: "assistant",
        content: [],
        stopReason: "aborted",
        errorMessage: "Operation aborted",
      },
    },
  ]);

  try {
    await harness.startSession();
    await harness.settleAgent();
    assert.equal(
      (await harness.readWorkerSnapshot("session-123", "worker-session")).latestSettlement.response,
      "Operation aborted",
    );
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
    else process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = original;
  }
});

for (const stopReason of ["toolUse", "length", "deferred", "pending"] as const) {
  test(`associated workers publish a ${stopReason} settlement without response text`, async () => {
    const harness = createHarness();
    const original = process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
    process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = "session-123";
    harness.setCurrentBranch("009-worker-recovery");
    harness.setBranchEntries([
      {
        type: "message",
        id: `assistant-${stopReason}`,
        message: {
          role: "assistant",
          content:
            stopReason === "toolUse"
              ? [{ type: "toolCall", id: "call-1", name: "structured_output", arguments: {} }]
              : [],
          stopReason,
        },
      },
    ]);

    try {
      await harness.startSession();
      await harness.settleAgent();
      assert.deepEqual(
        (await harness.readWorkerSnapshot("session-123", "worker-session")).latestSettlement,
        {
          assistantEntryId: `assistant-${stopReason}`,
          response: `Assistant stopped with reason: ${stopReason}.`,
          hadWatchedPr: false,
        },
      );
    } finally {
      await harness.shutdown();
      if (original === undefined) delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
      else process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = original;
    }
  });
}

test("orchestration delivers each latest no-PR settlement once and suppresses watched-PR settlements", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";

  try {
    await harness.writeWorkerSnapshot("session-123", "worker-session", [], {
      branch: "009-worker-recovery",
      assistantEntryId: "assistant-one",
      response: "A required credential is missing.",
      hadWatchedPr: false,
    });
    await harness.startSession();

    assert.match(
      harness.sentMessages[0] ?? "",
      /^worker 009-worker-recovery stopped without opening a pr and responded with the following message:\n\nA required credential is missing\.\n\n<!-- pr-watch-delivery:/,
    );

    await harness.runPoll();
    assert.equal(harness.sentMessages.length, 1);

    await harness.writeWorkerSnapshot("session-123", "worker-session", [], {
      branch: "009-worker-recovery",
      assistantEntryId: "assistant-two",
      response: "The second attempt also stopped.",
      hadWatchedPr: false,
    });
    await harness.runPoll();
    assert.match(harness.sentMessages[1] ?? "", /The second attempt also stopped\./);

    await harness.writeWorkerSnapshot("session-123", "worker-session", [104], {
      branch: "009-worker-recovery",
      assistantEntryId: "assistant-three",
      response: "The pull request is open.",
      hadWatchedPr: true,
    });
    await harness.runPoll();
    assert.equal(harness.sentMessages.length, 2);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("resolved worker settlements stay deduplicated after orchestration resume", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  await harness.writeWorkerSnapshot("session-123", "worker-session", [], {
    branch: "009-worker-recovery",
    assistantEntryId: "assistant-one",
    response: "A required credential is missing.",
    hadWatchedPr: false,
  });
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        watchedPrs: [],
        pendingPrUpdates: [],
        pendingWorkerSettlements: [],
        recentGhOutputs: [],
        orchestrationSessionId: "session-123",
        resolvedWorkerSettlementIds: ["worker-session:assistant-one"],
      },
    },
  ]);

  try {
    await harness.startSession("resume");
    assert.deepEqual(harness.sentMessages, []);
    await harness.runPoll();
    assert.deepEqual(harness.sentMessages, []);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("worker fallback waits in the existing delivery loop while the orchestrator is busy", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  harness.setIdle(false);

  try {
    await harness.writeWorkerSnapshot("session-123", "worker-session", [], {
      branch: "009-worker-recovery",
      assistantEntryId: "assistant-one",
      response: "A required credential is missing.",
      hadWatchedPr: false,
    });
    await harness.startSession();
    assert.deepEqual(harness.sentMessages, []);

    harness.setIdle(true);
    await harness.settleAgent();
    assert.equal(harness.sentMessages.length, 1);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("watches the session branch SHA and a PR created from another worktree", async () => {
  const harness = createHarness();
  await harness.startSession();

  await harness.activate(104);
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
});

test("restores concurrent session-branch SHA and worktree PR watches on resume", async () => {
  const harness = createHarness();
  await harness.startSession();
  await harness.activate(104);
  const savedState = structuredClone(harness.savedStates.at(-1));
  harness.setBranchEntries([{ type: "custom", customType: "pr-watch-state", data: savedState }]);

  await harness.startSession("resume");
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
});

test("does not watch a SHA separately when its session branch has an open PR", async () => {
  const harness = createHarness();
  harness.setCurrentBranch("remove-collapse-command");
  harness.setCurrentSha("abc104");
  await harness.startSession();

  await harness.activate(104);
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);
});

test("a fork PR with the same branch name does not suppress the session repository SHA", async () => {
  const harness = createHarness();
  harness.setCurrentBranch("remove-collapse-command");
  harness.setCurrentSha("session-repo-sha");
  harness.prs.get(104)!.headRepo = "another-owner/repos";
  await harness.startSession();

  await harness.activate(104);
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "session-repo-sha");
});

test("adds PRs created in multiple worktrees without replacing earlier watches", async () => {
  const harness = createHarness();

  await harness.activate(104);
  await harness.activate(105);
  await harness.activate(104);
  await harness.shutdown();

  assert.deepEqual(
    harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number),
    [104, 105],
  );
  assert.equal(
    harness.execCalls.some(
      ({ command, args }) => command === "gh" && args[0] === "pr" && args[1] === "checks" && args.includes(pr104Url),
    ),
    true,
  );
  assert.equal(
    harness.execCalls.some(
      ({ command, args }) => command === "gh" && args[0] === "pr" && args[1] === "checks" && args.includes(pr105Url),
    ),
    true,
  );
});

test("manual add accepts a PR number for the current repository", async () => {
  const harness = createHarness();
  await harness.startSession();

  await harness.commands.get("pr-watch")?.handler("add 104", harness.ctx);

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  assert.equal(harness.statuses.at(-1), "PR watch: #104");
  await harness.shutdown();
});

test("repeated gh pr activity does not notify for an already watched PR", async () => {
  const harness = createHarness();

  await harness.activate(104);
  assert.deepEqual(harness.notifications, ["PR watch added #104 (gh pr command)."]);

  await harness.activate(104, "view");
  assert.equal(harness.notifications.length, 1);

  await harness.shutdown();
});

test("gh pr view adds an open PR to the watch list", async () => {
  const harness = createHarness();

  await harness.activate(105, "view");
  await harness.shutdown();

  assert.deepEqual(
    harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number),
    [105],
  );
});

test("does not add a PR that is not open", async () => {
  const harness = createHarness();
  harness.prs.get(105)!.state = "MERGED";

  await harness.activate(104);
  await harness.activate(105);
  await harness.shutdown();

  assert.deepEqual(
    harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number),
    [104],
  );
});

test("with no watched PRs, PR watch uses the current checkout branch tip", async () => {
  const harness = createHarness();
  harness.prs.get(104)!.url = "https://github.com/another-owner/another-repo/pull/104";
  harness.prs.get(104)!.state = "MERGED";

  await harness.activate(104, "view");
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs, []);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.repo, "eli0shin/repos");
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
  assert.equal(
    harness.execCalls.some(
      ({ command, args }) =>
        command === "gh" && args[0] === "api" && args[1] === "repos/eli0shin/repos/commits/main",
    ),
    true,
  );
});

test("a failed SHA baseline after the session-branch PR closes remains retryable", async () => {
  const harness = createHarness();
  harness.setCurrentBranch("remove-collapse-command");
  harness.setCurrentSha("abc104");
  await harness.startSession();
  await harness.activate(104);
  harness.prs.get(104)!.state = "MERGED";
  harness.setRunsAvailable(false);

  await harness.runPoll();
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "abc104");

  harness.setRunsAvailable(true);
  harness.runs.push({
    databaseId: 120,
    attempt: 1,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/120",
  });
  await harness.runPoll();
  await harness.shutdown();

  assert.match(harness.sentMessages[0] ?? "", /CI finished for SHA abc104/);
});

test("a worktree PR keeps a failed restored SHA baseline retryable", async () => {
  const harness = createHarness();
  harness.setCurrentBranch("remove-collapse-command");
  harness.setCurrentSha("abc104");
  await harness.startSession();
  await harness.activate(104);
  await harness.activate(105);
  harness.prs.get(104)!.state = "MERGED";
  harness.setRunsAvailable(false);

  await harness.runPoll();
  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [105]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "abc104");

  harness.setRunsAvailable(true);
  harness.runs.push({
    databaseId: 119,
    attempt: 1,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/119",
  });
  await harness.runPoll();
  await harness.shutdown();

  assert.match(harness.sentMessages[0] ?? "", /CI finished for SHA abc104/);
});

test("an open worktree PR does not block CI for a changed session branch SHA", async () => {
  const harness = createHarness();
  await harness.startSession();
  await harness.activate(104);
  await harness.activate(105);
  harness.prs.get(105)!.state = "MERGED";
  harness.setCurrentSha("merged-105-sha");
  harness.runs.push({
    databaseId: 121,
    attempt: 1,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/121",
  });

  await harness.runPoll();
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "merged-105-sha");
  assert.match(harness.sentMessages[0] ?? "", /CI finished for SHA merged-/);
});

test("SHA watch follows the remote branch tip when local HEAD is stale", async () => {
  const harness = createHarness();
  harness.setLocalSha("stale-local-sha");
  await harness.startSession();
  await harness.push();
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");

  harness.setCurrentSha("remote-merge-sha");
  harness.runs.push({
    databaseId: 122,
    attempt: 1,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/122",
  });

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "remote-merge-sha");
  assert.match(harness.sentMessages[0] ?? "", /CI finished for SHA remote-/);
  assert.equal(
    harness.execCalls.some(
      ({ command, args }) => command === "gh" && args[0] === "run" && args.includes("remote-merge-sha"),
    ),
    true,
  );
});

test("session start alone does not start SHA watch", async () => {
  const harness = createHarness();
  await harness.startSession();
  await harness.shutdown();

  assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);
});

test("gh pr merge starts SHA watch for the current branch", async () => {
  const harness = createHarness();
  await harness.startSession();
  assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);

  await harness.merge();
  await harness.shutdown();

  assert.equal(harness.savedStates.at(-1)?.watchedSha?.repo, "eli0shin/repos");
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
});

test("gh run rerun starts SHA watch when nothing is being watched", async () => {
  const harness = createHarness();
  await harness.startSession();
  assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);

  await harness.rerun();
  await harness.shutdown();

  assert.equal(harness.savedStates.at(-1)?.watchedSha?.repo, "eli0shin/repos");
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
});

test("gh run rerun does not add a second watch when a PR is already watched", async () => {
  const harness = createHarness();
  harness.setCurrentBranch("remove-collapse-command");
  harness.setCurrentSha("abc104");
  await harness.startSession();
  await harness.activate(104);
  assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);

  await harness.rerun();
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);
});

test("ordinary SHA watch resolves a stale saved SHA on session resume", async () => {
  const harness = createHarness();
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        watchedPrs: [],
        watchedSha: { repo: "eli0shin/repos", sha: "stale-sha", notifiedChecksKey: "stale-runs" },
        pendingPrUpdates: [],
        recentGhOutputs: [],
      },
    },
  ]);
  harness.setCurrentSha("remote-resume-sha");

  await harness.startSession("resume");
  await harness.shutdown();

  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "remote-resume-sha");
});

test("ordinary SHA watch reports a failed startup baseline", async () => {
  const harness = createHarness();
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        watchedPrs: [],
        watchedSha: { repo: "eli0shin/repos", sha: "main-sha" },
        pendingPrUpdates: [],
        recentGhOutputs: [],
      },
    },
  ]);
  harness.setRunsAvailable(false);

  await harness.startSession("resume");
  await harness.shutdown();

  assert.match(harness.savedStates.at(-1)?.lastError ?? "", /Could not baseline workflow runs for SHA main-sha/);
});

test("SHA watch reports a branch-tip lookup failure and retains its current SHA", async () => {
  const harness = createHarness();
  await harness.startSession();
  await harness.push();
  harness.setBranchTipAvailable(false);

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
  assert.match(harness.savedStates.at(-1)?.lastError ?? "", /Could not resolve the GitHub tip of branch main/);
});

test("SHA watch notifies when a rerun reaches the same conclusion", async () => {
  const harness = createHarness();
  await harness.startSession();
  await harness.push();

  const run = {
    databaseId: 123,
    attempt: 1,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "failure",
    url: "https://github.com/eli0shin/repos/actions/runs/123",
    updatedAt: "2026-07-28T02:08:30Z",
  };
  harness.runs.push(run);
  await harness.runPoll();
  assert.equal(harness.sentMessages.length, 1);

  run.attempt = 2;
  run.status = "in_progress";
  run.conclusion = "";
  run.updatedAt = "2026-07-28T02:17:30Z";
  await harness.runPoll();
  assert.equal(harness.sentMessages.length, 1);

  run.status = "completed";
  run.conclusion = "failure";
  run.updatedAt = "2026-07-28T02:18:30Z";
  await harness.runPoll();
  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 2);
  assert.equal(
    harness.execCalls.some(
      ({ command, args }) =>
        command === "gh" &&
        args[0] === "run" &&
        args[1] === "list" &&
        args[args.indexOf("--json") + 1]?.split(",").includes("attempt"),
    ),
    true,
  );
});

test("standard PR watch notifies when failing CI finishes", async () => {
  const harness = createHarness();
  await harness.activate(104);
  harness.checks.set(104, [failingCheck("104")]);

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /CI finished for branch remove-collapse-command \(PR #104\)/);
  assert.match(harness.sentMessages[0] ?? "", /Branch: remove-collapse-command/);
});

test("standard PR watch notifies when a previously mergeable PR develops conflicts", async () => {
  const harness = createHarness();
  await harness.activate(104);
  harness.prs.get(104)!.mergeable = "CONFLICTING";

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /PR #104 now has merge conflicts that need to be resolved/);
  assert.match(harness.sentMessages[0] ?? "", /Use repos to resolve the conflicts/);
});

test("standard PR watch retains the last definitive status through an unknown mergeability poll", async () => {
  const harness = createHarness();
  await harness.activate(104);
  harness.prs.get(104)!.mergeable = "UNKNOWN";
  await harness.runPoll();
  harness.prs.get(104)!.mergeable = "CONFLICTING";

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /PR #104 now has merge conflicts/);
});

test("standard PR watch notifies when initial unknown mergeability resolves to conflicting", async () => {
  const harness = createHarness();
  harness.prs.get(104)!.mergeable = "UNKNOWN";
  await harness.activate(104);
  harness.prs.get(104)!.mergeable = "CONFLICTING";

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /PR #104 now has merge conflicts/);
});

test("standard PR watch notifies when conflicts exist before watching", async () => {
  const harness = createHarness();
  harness.prs.get(104)!.mergeable = "CONFLICTING";

  await harness.activate(104);
  await harness.settleAgent();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /PR #104 now has merge conflicts that need to be resolved/);
});

test("buffered conflict notification is discarded when the conflicts are resolved", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.commands.get("pr-watch")?.handler("pause", harness.ctx);
  harness.prs.get(104)!.mergeable = "CONFLICTING";
  await harness.runPoll();
  assert.equal(typeof harness.savedStates.at(-1)?.pendingPrUpdates[0]?.conflictsKey, "string");

  harness.prs.get(104)!.mergeable = "MERGEABLE";
  await harness.runPoll();
  await harness.commands.get("pr-watch")?.handler("resume", harness.ctx);
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 0);
  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
});

test("restart discards a persisted conflict notification after conflicts are resolved", async () => {
  const harness = createHarness();
  const pr = harness.prs.get(104)!;
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        watchedPrs: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: pr.headSha,
              authorLogin: pr.authorLogin,
            },
            seenActivityIds: [],
            mergeable: "CONFLICTING",
          },
        ],
        pendingPrUpdates: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: pr.headSha,
              authorLogin: pr.authorLogin,
            },
            conflictsKey: "old-conflict",
            feedbackActivities: [],
          },
        ],
        recentGhOutputs: [],
      },
    },
  ]);

  await harness.startSession();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 0);
  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
});

test("conflict notification does not tell a reviewer to modify another author's PR", async () => {
  const harness = createHarness();
  harness.prs.get(104)!.authorLogin = "another-author";
  await harness.activate(104);
  harness.prs.get(104)!.mergeable = "CONFLICTING";

  await harness.runPoll();
  await harness.shutdown();

  assert.match(harness.sentMessages[0] ?? "", /Do not edit files, commit, or push/);
  assert.doesNotMatch(harness.sentMessages[0] ?? "", /Use repos to resolve/);
});

test("orchestration watches a changed current SHA and reports already-complete CI in the same poll", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);
  const run = {
    databaseId: 900,
    attempt: 1,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/900",
  };
  harness.runs.push(run);

  try {
    await harness.startSession();
    assert.equal(harness.sentMessages.length, 0, "the first observed SHA must be baselined");
    assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
    assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);

    harness.setCurrentSha("merged-sha");
    run.databaseId = 901;
    run.url = "https://github.com/eli0shin/repos/actions/runs/901";
    await harness.runPoll();

    assert.equal(harness.sentMessages.length, 1);
    assert.match(harness.sentMessages[0] ?? "", /CI finished for SHA merged-/);
    assert.equal(
      harness.execCalls.some(
        ({ command, args }) => command === "gh" && args[0] === "run" && args.includes("merged-sha"),
      ),
      true,
    );
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("orchestration retries and baselines its first SHA observation", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  harness.setCurrentTargetAvailable(false);
  harness.runs.push({
    databaseId: 910,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/910",
  });

  try {
    await harness.startSession();
    assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);

    harness.setCurrentTargetAvailable(true);
    await harness.runPoll();

    assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
    assert.equal(harness.sentMessages.length, 0);
    assert.equal(
      harness.execCalls.filter(({ command, args }) => command === "gh" && args[0] === "repo").length >= 2,
      true,
    );
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("orchestration retries a failed first-SHA baseline without reporting existing CI", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  harness.setRunsAvailable(false);
  harness.runs.push({
    databaseId: 920,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/920",
  });

  try {
    await harness.startSession();
    assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);

    harness.setRunsAvailable(true);
    await harness.runPoll();

    assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
    assert.equal(harness.sentMessages.length, 0);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("orchestration preserves its SHA baseline across session resume", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  const run = {
    databaseId: 930,
    attempt: 1,
    name: "Terraform",
    workflowName: "Terraform",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/eli0shin/repos/actions/runs/930",
  };
  harness.runs.push(run);

  try {
    await harness.startSession();
    const savedState = structuredClone(harness.savedStates.at(-1));
    harness.setBranchEntries([{ type: "custom", customType: "pr-watch-state", data: savedState }]);
    run.databaseId = 931;
    run.url = "https://github.com/eli0shin/repos/actions/runs/931";

    await harness.startSession("resume");
    await harness.runPoll();

    assert.equal(harness.sentMessages.length, 1);
    assert.match(harness.sentMessages[0] ?? "", /CI finished for SHA main-sh\./);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

for (const timing of ["before watching", "after watching"] as const) {
  test(`orchestration PR watch does not notify when a worker PR has conflicts ${timing}`, async () => {
    const harness = createHarness();
    const original = process.env.PI_ORCHESTRATION_SESSION_ID;
    process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
    await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);
    if (timing === "before watching") harness.prs.get(104)!.mergeable = "CONFLICTING";

    try {
      await harness.startSession();
      if (timing === "after watching") {
        harness.prs.get(104)!.mergeable = "CONFLICTING";
        await harness.runPoll();
      }

      assert.equal(harness.sentMessages.length, 0);
    } finally {
      await harness.shutdown();
      if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
      else process.env.PI_ORCHESTRATION_SESSION_ID = original;
    }
  });
}

test("batches updates from multiple watched PRs into one agent message", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.activate(105);
  harness.checks.set(104, [terminalCheck("104")]);
  harness.checks.set(105, [terminalCheck("105")]);

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /detected multiple updates/);
  assert.match(harness.sentMessages[0] ?? "", /branch remove-collapse-command \(PR #104\)/);
  assert.match(harness.sentMessages[0] ?? "", /branch second-feature \(PR #105\)/);
});

test("bot-authored reviews trigger feedback for the correct branch", async () => {
  const harness = createHarness();
  await harness.activate(104);
  harness.reviews.set(104, [{ id: 4689083037, user: { login: "review-bot[bot]", type: "Bot" } }]);

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /New PR feedback was added for branch remove-collapse-command \(PR #104\)/);
  assert.match(harness.sentMessages[0] ?? "", /review:4689083037 by review-bot\[bot\]/);
});

test("manual removal restores the session branch SHA while other worktree PRs remain", async () => {
  const harness = createHarness();
  harness.setCurrentBranch("remove-collapse-command");
  harness.setCurrentSha("abc104");
  await harness.startSession();
  await harness.activate(104);
  await harness.activate(105);
  assert.equal(harness.savedStates.at(-1)?.watchedSha, undefined);

  await harness.commands.get("pr-watch")?.handler("remove 104", harness.ctx);
  await harness.shutdown();

  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [105]);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "abc104");
});

test("manual remove stops watching only the selected PR", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.activate(105);

  await harness.commands.get("pr-watch")?.handler("remove 104", harness.ctx);
  await harness.shutdown();

  assert.deepEqual(
    harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number),
    [105],
  );
});

test("buffers busy updates internally and delivers one batch after the agent settles", async () => {
  const harness = createHarness();
  await harness.activate(104);
  harness.setIdle(false);
  harness.checks.set(104, [terminalCheck("104")]);

  await harness.runPoll();
  harness.reviews.set(104, [{ id: 4689083037, user: { login: "reviewer", type: "User" } }]);
  await harness.runPoll();

  assert.equal(harness.sentMessages.length, 0);
  assert.equal(harness.savedStates.at(-1)?.pendingPrUpdates[0]?.checksHeadSha, "abc104");
  assert.equal(harness.savedStates.at(-1)?.pendingPrUpdates[0]?.feedbackActivities.length, 1);
  assert.match(harness.notifications.at(-1) ?? "", /buffered 1 update \(2 pending\)/);

  harness.setIdle(true);
  await harness.settleAgent();

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessageOptions[0], undefined);
  assert.match(harness.sentMessages[0] ?? "", /CI finished/);
  assert.match(harness.sentMessages[0] ?? "", /review:4689083037/);
  assert.equal(harness.savedStates.at(-1)?.pendingPrUpdates.length, 0);
});

test("pause keeps polling, shows pending status, and resume delivers only when needed", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.commands.get("pr-watch")?.handler("pause", harness.ctx);
  harness.checks.set(104, [terminalCheck("104")]);

  await harness.runPoll();

  assert.equal(harness.sentMessages.length, 0);
  assert.match(harness.statuses.at(-1) ?? "", /paused • 1 pending/);

  await harness.commands.get("pr-watch")?.handler("resume", harness.ctx);
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.savedStates.at(-1)?.mode, "active");

  await harness.commands.get("pr-watch")?.handler("pause", harness.ctx);
  await harness.commands.get("pr-watch")?.handler("resume", harness.ctx);
  assert.equal(harness.sentMessages.length, 1, "resume without pending updates must not trigger the agent");
});

test("pause from off restarts polling and on also resumes delivery", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.commands.get("pr-watch")?.handler("off", harness.ctx);
  assert.equal(harness.savedStates.at(-1)?.mode, "off");
  assert.equal(harness.statuses.at(-1), undefined);

  await harness.commands.get("pr-watch")?.handler("pause", harness.ctx);
  assert.equal(harness.savedStates.at(-1)?.mode, "paused");
  assert.match(harness.statuses.at(-1) ?? "", /paused/);

  harness.checks.set(104, [terminalCheck("104")]);
  await harness.runPoll();
  assert.equal(harness.sentMessages.length, 0);

  await harness.commands.get("pr-watch")?.handler("on", harness.ctx);
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.savedStates.at(-1)?.mode, "active");
  await harness.shutdown();
});

test("on reconciles retained updates before delivering after off", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.commands.get("pr-watch")?.handler("pause", harness.ctx);
  harness.checks.set(104, [terminalCheck("old")]);
  await harness.runPoll();
  await harness.commands.get("pr-watch")?.handler("off", harness.ctx);

  harness.prs.get(104)!.headSha = "new104";
  harness.checks.set(104, []);
  await harness.commands.get("pr-watch")?.handler("on", harness.ctx);

  assert.equal(harness.sentMessages.length, 0);
  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
  await harness.shutdown();
});

test("version 3 state is not migrated", async () => {
  const harness = createHarness();
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 3,
        mode: "paused",
        watchedPrs: [{ pr: { number: 104 } }],
        pendingPrUpdates: [],
        recentGhOutputs: [],
      },
    },
  ]);

  await harness.startSession();

  assert.equal(harness.savedStates.at(-1)?.version, 4);
  assert.equal(harness.savedStates.at(-1)?.mode, "active");
  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs, []);
});

test("orchestration startup unions worker snapshots across repositories", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  harness.prs.get(105)!.url = "https://github.com/another/repository/pull/105";
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);
  await harness.writeWorkerSnapshot("session-123", "worker-two", [105]);

  try {
    await harness.startSession();

    assert.deepEqual(
      harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => `${pr.repo}#${pr.number}`).sort(),
      ["another/repository#105", "eli0shin/repos#104"],
    );
    assert.equal(harness.sentMessages.length, 0);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("worker snapshot discovery stays silent while the orchestrator is busy", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";

  try {
    await harness.startSession();
    harness.setIdle(false);
    await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);
    await harness.runPoll();
    assert.equal(harness.sentMessages.length, 0);

    harness.setIdle(true);
    await harness.settleAgent();
    assert.equal(harness.sentMessages.length, 0);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("reset preserves orchestration mode and reports a branch-tip failure", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";

  try {
    await harness.startSession();
    harness.setBranchTipAvailable(false);
    await harness.commands.get("pr-watch")?.handler("reset", harness.ctx);
    await harness.shutdown();

    assert.equal(harness.savedStates.at(-1)?.orchestrationSessionId, "session-123");
    assert.match(harness.savedStates.at(-1)?.lastError ?? "", /Could not resolve the GitHub tip of branch main/);
  } finally {
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("worker snapshots re-add a manually removed orchestration PR", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);

  try {
    await harness.startSession();
    await harness.commands.get("pr-watch")?.handler("remove 104", harness.ctx);
    await harness.runPoll();

    assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("orchestration discovery notifies when checks are already passing", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  harness.checks.set(104, [terminalCheck("104")]);
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);

  try {
    await harness.startSession();

    assert.equal(harness.sentMessages.length, 1);
    assert.match(harness.sentMessages[0] ?? "", /^CI finished for worker PR #104\./);
  } finally {
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("orchestration sessions do not receive failed CI notifications", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);

  try {
    await harness.startSession();
    harness.checks.set(104, [failingCheck("104")]);
    await harness.runPoll();

    assert.equal(harness.sentMessages.length, 0);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("orchestration sessions receive a concise CI notification", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);

  try {
    await harness.startSession();
    harness.checks.set(104, [terminalCheck("104")]);
    await harness.runPoll();

    assert.equal(harness.sentMessages.length, 1);
    assert.match(
      harness.sentMessages[0] ?? "",
      /^CI finished for worker PR #104\.\n\nhttps:\/\/github\.com\/eli0shin\/repos\/pull\/104/,
    );
    assert.doesNotMatch(
      harness.sentMessages[0] ?? "",
      /Branch:|SHA|session-123|Please|inspect|determine|diagnose|authored by you/,
    );
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("orchestration sessions receive a concise activity notification", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);

  try {
    await harness.startSession();
    harness.reviews.set(104, [
      { id: 77, user: { login: "reviewer", type: "User" } },
      { id: 78, user: { login: "chatgpt-codex-connector[bot]", type: "Bot" } },
    ]);
    await harness.runPoll();

    assert.equal(harness.sentMessages.length, 1);
    assert.match(
      harness.sentMessages[0] ?? "",
      /^New activity on worker PR #104:\n- review:77 by reviewer\n\nhttps:\/\/github\.com\/eli0shin\/repos\/pull\/104/,
    );
    assert.doesNotMatch(harness.sentMessages[0] ?? "", /chatgpt-codex-connector|review:78/);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("a corrupt worker snapshot retains its cache while other workers reconcile", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "session-123";
  await harness.writeWorkerSnapshot("session-123", "worker-one", [104]);
  await harness.writeWorkerSnapshot("session-123", "worker-two", [105]);

  try {
    await harness.startSession();
    await harness.corruptWorkerSnapshot("session-123", "worker-one");
    await harness.writeWorkerSnapshot("session-123", "worker-two", []);
    await harness.runPoll();

    assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number), [104]);
    assert.match(harness.savedStates.at(-1)?.lastError ?? "", /worker-one/);
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("persisted orchestration session wins and restores the process environment", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "environment-session";
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        orchestrationSessionId: "persisted-session",
        watchedPrs: [],
        watchedSha: { repo: "eli0shin/repos", sha: "stale-sha", notifiedChecksKey: "stale-runs" },
        pendingPrUpdates: [],
        pendingShaUpdate: { repo: "eli0shin/repos", sha: "stale-sha", runsKey: "stale-runs" },
        recentGhOutputs: [],
      },
    },
  ]);

  try {
    await harness.startSession();

    assert.equal(harness.savedStates.at(-1)?.orchestrationSessionId, "persisted-session");
    assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
    assert.equal(harness.savedStates.at(-1)?.pendingShaUpdate, undefined);
    assert.equal(process.env.PI_ORCHESTRATION_SESSION_ID, "persisted-session");
    assert.equal(
      execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.PI_ORCHESTRATION_SESSION_ID ?? '')"], {
        encoding: "utf8",
      }),
      "persisted-session",
    );
  } finally {
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("startup orchestration replaces persisted ordinary state", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "new-session";
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "paused",
        watchedPrs: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: 104,
              url: pr104Url,
              branch: "remove-collapse-command",
              headSha: "abc104",
              authorLogin: "eli0shin",
            },
            seenActivityIds: [],
          },
        ],
        pendingPrUpdates: [],
        recentGhOutputs: ["ordinary-session-output"],
      },
    },
  ]);

  try {
    await harness.startSession();

    const promotedState = harness.savedStates.at(-1);
    assert.equal(promotedState?.orchestrationSessionId, "new-session");
    assert.equal(promotedState?.mode, "active");
    assert.deepEqual(promotedState?.watchedPrs, []);
    assert.deepEqual(promotedState?.recentGhOutputs, []);
    assert.equal(process.env.PI_ORCHESTRATION_SESSION_ID, "new-session");
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("resuming persisted ordinary state enrolls it in the requested orchestration", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "requested-session";
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        watchedPrs: [],
        pendingPrUpdates: [],
        recentGhOutputs: [],
      },
    },
  ]);

  try {
    await harness.startSession("resume");

    assert.equal(harness.savedStates.at(-1)?.orchestrationSessionId, "requested-session");
    assert.equal(process.env.PI_ORCHESTRATION_SESSION_ID, "requested-session");
    assert.equal(
      execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.PI_ORCHESTRATION_SESSION_ID ?? '')"], {
        encoding: "utf8",
      }),
      "requested-session",
    );
  } finally {
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("resuming a state-less session enrolls it in the requested orchestration", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  process.env.PI_ORCHESTRATION_SESSION_ID = "requested-session";

  try {
    await harness.startSession("resume");

    assert.equal(harness.savedStates.at(-1)?.orchestrationSessionId, "requested-session");
    assert.equal(process.env.PI_ORCHESTRATION_SESSION_ID, "requested-session");
    assert.equal(
      execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.PI_ORCHESTRATION_SESSION_ID ?? '')"], {
        encoding: "utf8",
      }),
      "requested-session",
    );
  } finally {
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

test("transient refresh failure does not drop a persisted orchestration watch", async () => {
  const harness = createHarness();
  const original = process.env.PI_ORCHESTRATION_SESSION_ID;
  delete process.env.PI_ORCHESTRATION_SESSION_ID;
  const pr = harness.prs.get(104)!;
  harness.unavailablePrs.add(104);
  await harness.writeWorkerSnapshot("persisted-session", "worker-one", [104]);
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        orchestrationSessionId: "persisted-session",
        watchedPrs: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: pr.headSha,
              authorLogin: pr.authorLogin,
            },
            seenActivityIds: [],
          },
        ],
        pendingPrUpdates: [],
        recentGhOutputs: [],
      },
    },
  ]);

  try {
    await harness.startSession();

    assert.deepEqual(
      harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number),
      [104],
    );
  } finally {
    await harness.shutdown();
    if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
    else process.env.PI_ORCHESTRATION_SESSION_ID = original;
  }
});

for (const reason of ["reload", "resume"]) {
  test(`orchestration enrollment stays sticky across ${reason}`, async () => {
    const harness = createHarness();
    const original = process.env.PI_ORCHESTRATION_SESSION_ID;
    delete process.env.PI_ORCHESTRATION_SESSION_ID;
    const pr = harness.prs.get(104)!;
    await harness.writeWorkerSnapshot("persisted-session", "worker-one", [104]);
    harness.setBranchEntries([
      {
        type: "custom",
        customType: "pr-watch-state",
        data: {
          version: 4,
          mode: "active",
          orchestrationSessionId: "persisted-session",
          watchedPrs: [
            {
              pr: {
                repo: "eli0shin/repos",
                number: pr.number,
                url: pr.url,
                branch: pr.branch,
                headSha: pr.headSha,
                authorLogin: pr.authorLogin,
              },
              seenActivityIds: [],
            },
          ],
          pendingPrUpdates: [],
          recentGhOutputs: [],
        },
      },
    ]);

    try {
      await harness.startSession(reason);

      assert.deepEqual(
        harness.savedStates.at(-1)?.watchedPrs.map(({ pr }: any) => pr.number),
        [104],
      );
      assert.equal(process.env.PI_ORCHESTRATION_SESSION_ID, "persisted-session");
    } finally {
      await harness.shutdown();
      if (original === undefined) delete process.env.PI_ORCHESTRATION_SESSION_ID;
      else process.env.PI_ORCHESTRATION_SESSION_ID = original;
    }
  });
}

test("version 4 paused pending state survives session restart", async () => {
  const harness = createHarness();
  const pr = harness.prs.get(104)!;
  harness.reviews.set(104, [{ id: 77, user: { login: "reviewer", type: "User" } }]);
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "paused",
        watchedPrs: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: pr.headSha,
              authorLogin: pr.authorLogin,
            },
            seenActivityIds: [],
          },
        ],
        pendingPrUpdates: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: pr.headSha,
              authorLogin: pr.authorLogin,
            },
            feedbackActivities: [{ id: "review:77", authorLogin: "reviewer" }],
          },
        ],
        recentGhOutputs: [],
      },
    },
  ]);

  await harness.startSession();

  assert.equal(harness.sentMessages.length, 0);
  assert.equal(harness.savedStates.at(-1)?.mode, "paused");
  assert.equal(harness.savedStates.at(-1)?.pendingPrUpdates.length, 1);
  assert.match(harness.statuses.at(-1) ?? "", /paused • 1 pending/);
});

test("restart discards buffered CI for an obsolete head SHA", async () => {
  const harness = createHarness();
  const pr = harness.prs.get(104)!;
  harness.prs.get(104)!.headSha = "new104";
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "paused",
        watchedPrs: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: "old104",
              authorLogin: pr.authorLogin,
            },
            seenActivityIds: [],
          },
        ],
        pendingPrUpdates: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: "old104",
              authorLogin: pr.authorLogin,
            },
            checksHeadSha: "old104",
            checksKey: "old-key",
            feedbackActivities: [],
          },
        ],
        recentGhOutputs: [],
      },
    },
  ]);

  await harness.startSession();

  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
  assert.match(harness.statuses.at(-1) ?? "", /paused$/);
});

test("restart discards buffered CI when the same head no longer has terminal checks", async () => {
  const harness = createHarness();
  const pr = harness.prs.get(104)!;
  harness.checks.set(104, []);
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "paused",
        watchedPrs: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: pr.headSha,
              authorLogin: pr.authorLogin,
            },
            seenActivityIds: [],
          },
        ],
        pendingPrUpdates: [
          {
            pr: {
              repo: "eli0shin/repos",
              number: pr.number,
              url: pr.url,
              branch: pr.branch,
              headSha: pr.headSha,
              authorLogin: pr.authorLogin,
            },
            checksHeadSha: pr.headSha,
            checksKey: "stale-terminal-key",
            feedbackActivities: [],
          },
        ],
        recentGhOutputs: [],
      },
    },
  ]);

  await harness.startSession();

  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
});

test("persisted delivery marker prevents duplicate delivery after restart", async () => {
  const harness = createHarness();
  const id = "delivery-123";
  const message = `Buffered PR update\n\n<!-- pr-watch-delivery:${id} -->`;
  const pending = {
    pr: {
      repo: "eli0shin/repos",
      number: 104,
      url: pr104Url,
      branch: "remove-collapse-command",
      headSha: "abc104",
      authorLogin: "eli0shin",
    },
    feedbackActivities: [{ id: "review:77", authorLogin: "reviewer" }],
  };
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 4,
        mode: "active",
        watchedPrs: [],
        pendingPrUpdates: [pending],
        pendingDelivery: { id, message, pendingPrUpdates: [pending] },
        recentGhOutputs: [],
      },
    },
    { type: "message", message: { role: "user", content: [{ type: "text", text: message }] } },
  ]);

  await harness.startSession();

  assert.equal(harness.sentMessages.length, 0);
  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
  assert.equal(harness.savedStates.at(-1)?.pendingDelivery, undefined);
});

test("new head SHA and deleted feedback prune stale pending updates", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.commands.get("pr-watch")?.handler("pause", harness.ctx);
  harness.checks.set(104, [terminalCheck("old")]);
  harness.reviews.set(104, [{ id: 10, user: { login: "reviewer", type: "User" } }]);
  await harness.runPoll();
  assert.equal(harness.savedStates.at(-1)?.pendingPrUpdates[0]?.feedbackActivities.length, 1);

  harness.prs.get(104)!.headSha = "new104";
  harness.checks.set(104, []);
  harness.reviews.set(104, []);
  await harness.runPoll();

  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
  assert.match(harness.statuses.at(-1) ?? "", /paused$/);
});

test("closing a PR or manually removing it discards its pending updates", async () => {
  const harness = createHarness();
  await harness.activate(104);
  await harness.commands.get("pr-watch")?.handler("pause", harness.ctx);
  harness.checks.set(104, [terminalCheck("104")]);
  await harness.runPoll();

  harness.prs.get(104)!.state = "MERGED";
  await harness.runPoll();
  assert.deepEqual(harness.savedStates.at(-1)?.pendingPrUpdates, []);
  assert.equal(harness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");

  const secondHarness = createHarness();
  await secondHarness.activate(104);
  await secondHarness.commands.get("pr-watch")?.handler("pause", secondHarness.ctx);
  secondHarness.checks.set(104, [terminalCheck("104")]);
  await secondHarness.runPoll();
  await secondHarness.commands.get("pr-watch")?.handler("remove 104", secondHarness.ctx);
  assert.deepEqual(secondHarness.savedStates.at(-1)?.pendingPrUpdates, []);
  assert.equal(secondHarness.savedStates.at(-1)?.watchedSha?.sha, "main-sha");
});
