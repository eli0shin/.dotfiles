import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPrWatchController } from "../lib/pr-watch-core.ts";
import { atomicWriteJson, sessionStatePath } from "../lib/pr-watch-ipc.ts";

const prUrl = "https://github.com/eli0shin/repos/pull/104";

function createExecutor(
  options: {
    mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    checks?: unknown[];
    reviews?: unknown[];
    runs?: unknown[];
    state?: string;
    failChecks?: boolean;
    login?: string;
  } = {},
) {
  return async (command: string, args: string[]) => {
    if (command === "gh" && args[0] === "repo")
      return {
        code: 0,
        stdout: JSON.stringify({ nameWithOwner: "eli0shin/repos" }),
        stderr: "",
      };
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      if (!args.includes(prUrl)) return { code: 1, stdout: "", stderr: "no pull request found" };
      return {
        code: 0,
        stdout: JSON.stringify({
          number: 104,
          url: prUrl,
          headRefName: "worktree-feature",
          headRefOid: "pr-sha",
          headRepository: { nameWithOwner: "eli0shin/repos" },
          state: options.state ?? "OPEN",
          author: { login: "eli0shin" },
          mergeable: options.mergeable ?? "MERGEABLE",
        }),
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
      if (options.failChecks) return { code: 1, stdout: "", stderr: "checks unavailable" };
      return {
        code: 0,
        stdout: JSON.stringify(options.checks ?? []),
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "api" && args[1] === "user")
      return {
        code: 0,
        stdout: JSON.stringify({ login: options.login ?? "eli0shin" }),
        stderr: "",
      };
    if (command === "gh" && args[0] === "api" && args[1]?.includes("/commits/"))
      return {
        code: 0,
        stdout: JSON.stringify({ sha: "main-sha" }),
        stderr: "",
      };
    if (command === "gh" && args[0] === "api") {
      return {
        code: 0,
        stdout: JSON.stringify(args[1]?.endsWith("/reviews?per_page=100") ? (options.reviews ?? []) : []),
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "run")
      return { code: 0, stdout: JSON.stringify(options.runs ?? []), stderr: "" };
    if (command === "git" && args[0] === "branch") return { code: 0, stdout: "main\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unsupported command" };
  };
}

test("an ordinary controller removes a stale persisted orchestration identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  await atomicWriteJson(sessionStatePath(root, "ordinary"), {
    version: 1,
    mode: "active",
    watchedPrs: [],
    pendingPrUpdates: [],
    pendingWorkerSettlements: [],
    recentGhOutputs: [],
    orchestrationSessionId: "foreign-parent",
  });
  const controller = await createPrWatchController({
    sessionID: "ordinary",
    directory: "/repo",
    root,
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    assert.equal(controller.getState().orchestrationSessionId, undefined);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("watches the session branch SHA with a PR from another worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("git push", "main -> main", true);
    await controller.observeShell("cd /worktree && gh pr create", `${prUrl}\n`, true);

    const state = controller.getState();
    assert.equal(state.watchedPrs.length, 1);
    assert.equal(state.watchedSha?.sha, "main-sha");
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("starts branch SHA watch after merging a PR", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("gh pr merge --squash", "Merged pull request", true);
    assert.equal(controller.getState().watchedSha?.sha, "main-sha");
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("reports conflicts that exist when a PR is enrolled", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const messages: string[] = [];
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async (message: string) => messages.push(message),
    exec: createExecutor({ mergeable: "CONFLICTING" }),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("gh pr create", `${prUrl}\n`, true);
    assert.match(messages.join("\n"), /merge conflicts/);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("an OpenCode worker publishes its watched PR membership", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const coordinationRoot = join(root, "orchestrations");
  const controller = await createPrWatchController({
    sessionID: "worker-session",
    directory: "/repo",
    root,
    coordinationRoot,
    workerOrchestrationID: "parent-session",
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("gh pr create", `${prUrl}\n`, true);
    const snapshot = JSON.parse(
      await readFile(join(coordinationRoot, "parent-session", "worker-session.json"), "utf8"),
    );
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.branch, "main");
    assert.deepEqual(snapshot.watchedPrs, [{ repo: "eli0shin/repos", number: 104, url: prUrl }]);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("an OpenCode parent reports a worker that settles without a PR", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const coordinationRoot = join(root, "orchestrations");
  const worker = await createPrWatchController({
    sessionID: "worker-session",
    directory: "/repo",
    root,
    coordinationRoot,
    workerOrchestrationID: "parent-session",
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  const messages: string[] = [];
  const parent = await createPrWatchController({
    sessionID: "parent",
    directory: "/repo",
    root,
    coordinationRoot,
    orchestrationID: "parent-session",
    wake: async (message: string) => messages.push(message),
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  try {
    await worker.initialize();
    await worker.settle("assistant-one", "Implementation stopped before opening a PR.");
    await parent.initialize();
    await parent.poll();
    assert.match(messages.join("\n"), /worker main stopped without opening a pr/i);
    assert.match(messages.join("\n"), /Implementation stopped/);
  } finally {
    worker.dispose();
    parent.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("buffers updates while OpenCode is busy and delivers one harness message when idle", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const fixture: { checks: unknown[]; reviews: unknown[] } = {
    checks: [],
    reviews: [],
  };
  const messages: string[] = [];
  let idle = true;
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async (message: string) => messages.push(message),
    exec: createExecutor(fixture),
    isIdle: () => idle,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("gh pr create", `${prUrl}\n`, true);
    idle = false;
    fixture.checks.push({
      name: "test",
      state: "SUCCESS",
      bucket: "pass",
      workflow: "CI",
      link: "https://github.com/eli0shin/repos/actions/runs/1",
      completedAt: "2026-09-11T00:00:00Z",
    });
    fixture.reviews.push({ id: 9, user: { login: "reviewer", type: "User" } });
    await controller.poll();
    assert.equal(messages.length, 0);
    assert.deepEqual(
      controller.getState().notifications?.map((notification) => notification.message),
      ["PR watch added #104 (gh pr command).", "PR Watch buffered 2 updates (2 pending)."],
    );

    idle = true;
    await controller.flushPending();
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? "", /^<pr-watch-harness-notification>/);
    assert.match(messages[0] ?? "", /CI finished/);
    assert.match(messages[0] ?? "", /PR feedback/i);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a pending delivery after a wake failure and retries it", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const messages: string[] = [];
  let failWake = true;
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async (message: string) => {
      if (failWake) throw new Error("wake failed");
      messages.push(message);
    },
    exec: createExecutor({ mergeable: "CONFLICTING" }),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("gh pr create", `${prUrl}\n`, true);
    assert.equal(controller.getState().pendingPrUpdates.length, 1);
    assert.ok(controller.getState().pendingDelivery);

    failWake = false;
    await controller.flushPending();
    assert.equal(messages.length, 1);
    assert.equal(controller.getState().pendingPrUpdates.length, 0);
    assert.equal(controller.getState().pendingDelivery, undefined);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("resume acknowledges an admitted delivery without sending it again", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const pr = {
    repo: "eli0shin/repos",
    number: 104,
    url: prUrl,
    branch: "worktree-feature",
    headSha: "pr-sha",
  };
  const pending = {
    pr,
    checksHeadSha: "pr-sha",
    checksKey: "checks-key",
    feedbackActivities: [],
  };
  await atomicWriteJson(sessionStatePath(root, "session-one"), {
    version: 1,
    mode: "active",
    watchedPrs: [],
    pendingPrUpdates: [pending],
    pendingWorkerSettlements: [],
    recentGhOutputs: [],
    pendingDelivery: {
      id: "delivery-one",
      message: "<pr-watch-harness-notification><!-- pr-watch-delivery:delivery-one --></pr-watch-harness-notification>",
      pendingPrUpdates: [pending],
      pendingWorkerSettlements: [],
    },
  });
  let wakeCount = 0;
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => {
      wakeCount += 1;
    },
    hasDelivery: async (id: string) => id === "delivery-one",
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    assert.equal(wakeCount, 0);
    assert.equal(controller.getState().pendingDelivery, undefined);
    assert.equal(controller.getState().pendingPrUpdates.length, 0);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("resume does not resend the valid part of a partially stale admitted delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const settlement = {
    workerSessionId: "worker-one",
    assistantEntryId: "assistant-one",
    branch: "worker-branch",
    response: "Stopped before opening a PR.",
  };
  const pendingShaUpdate = { repo: "eli0shin/repos", sha: "main-sha", runsKey: "old-key" };
  await atomicWriteJson(sessionStatePath(root, "session-one"), {
    version: 1,
    mode: "active",
    watchedPrs: [],
    watchedSha: { repo: "eli0shin/repos", sha: "main-sha", notifiedChecksKey: "old-key" },
    pendingPrUpdates: [],
    pendingShaUpdate,
    pendingWorkerSettlements: [settlement],
    recentGhOutputs: [],
    pendingDelivery: {
      id: "delivery-one",
      message: "<pr-watch-harness-notification><!-- pr-watch-delivery:delivery-one --></pr-watch-harness-notification>",
      pendingPrUpdates: [],
      pendingShaUpdate,
      pendingWorkerSettlements: [settlement],
    },
  });
  let wakeCount = 0;
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => {
      wakeCount += 1;
    },
    hasDelivery: async () => true,
    exec: createExecutor({ runs: [{ databaseId: 1, status: "in_progress" }] }),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    assert.equal(wakeCount, 0);
    assert.equal(controller.getState().pendingDelivery, undefined);
    assert.equal(controller.getState().pendingShaUpdate, undefined);
    assert.equal(controller.getState().pendingWorkerSettlements.length, 0);
    assert.deepEqual(controller.getState().resolvedWorkerSettlementIds, ["worker-one:assistant-one"]);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("startup discards a saved SHA completion when its run is no longer terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  await atomicWriteJson(sessionStatePath(root, "session-one"), {
    version: 1,
    mode: "active",
    watchedPrs: [],
    watchedSha: {
      repo: "eli0shin/repos",
      sha: "main-sha",
      notifiedChecksKey: "old-key",
    },
    pendingPrUpdates: [],
    pendingShaUpdate: {
      repo: "eli0shin/repos",
      sha: "main-sha",
      runsKey: "old-key",
    },
    pendingWorkerSettlements: [],
    recentGhOutputs: [],
  });
  const messages: string[] = [];
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async (message: string) => messages.push(message),
    exec: createExecutor({ runs: [{ databaseId: 1, status: "in_progress" }] }),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    assert.equal(controller.getState().pendingShaUpdate, undefined);
    assert.equal(messages.length, 0);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("startup removes a saved PR that closed while OpenCode was stopped", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const fixture = { state: "OPEN" };
  const first = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => undefined,
    exec: createExecutor(fixture),
    isIdle: () => true,
  } as any);
  try {
    await first.initialize();
    await first.observeShell("gh pr create", `${prUrl}\n`, true);
    assert.equal(first.getState().watchedPrs.length, 1);
    first.dispose();

    fixture.state = "CLOSED";
    const resumed = await createPrWatchController({
      sessionID: "session-one",
      directory: "/repo",
      root,
      wake: async () => undefined,
      exec: createExecutor(fixture),
      isIdle: () => true,
    } as any);
    try {
      await resumed.initialize();
      assert.equal(resumed.getState().watchedPrs.length, 0);
      assert.equal(resumed.getState().watchedSha?.sha, "main-sha");
    } finally {
      resumed.dispose();
    }
  } finally {
    first.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("startup reconciles stale pending PR updates before delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const fixture: { checks: unknown[] } = { checks: [] };
  let idle = false;
  const first = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => undefined,
    exec: createExecutor(fixture),
    isIdle: () => idle,
  } as any);
  try {
    await first.initialize();
    await first.observeShell("gh pr create", `${prUrl}\n`, true);
    fixture.checks = [
      {
        name: "test",
        state: "SUCCESS",
        bucket: "pass",
        completedAt: "2026-09-11",
      },
    ];
    await first.poll();
    assert.equal(first.getState().pendingPrUpdates.length, 1);
    first.dispose();

    fixture.checks = [];
    idle = true;
    const messages: string[] = [];
    const resumed = await createPrWatchController({
      sessionID: "session-one",
      directory: "/repo",
      root,
      wake: async (message: string) => messages.push(message),
      exec: createExecutor(fixture),
      isIdle: () => idle,
    } as any);
    try {
      await resumed.initialize();
      assert.equal(resumed.getState().pendingPrUpdates.length, 0);
      assert.equal(messages.length, 0);
    } finally {
      resumed.dispose();
    }
  } finally {
    first.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("a clean poll clears a prior polling error", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const fixture = { failChecks: false };
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => undefined,
    exec: createExecutor(fixture),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("gh pr create", `${prUrl}\n`, true);
    fixture.failChecks = true;
    await controller.poll();
    assert.match(controller.getState().lastError ?? "", /checks unavailable/);
    fixture.failChecks = false;
    await controller.poll();
    assert.equal(controller.getState().lastError, undefined);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("polling refreshes the authenticated GitHub identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const fixture = { login: "first-user" };
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async () => undefined,
    exec: createExecutor(fixture),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    assert.equal(controller.getState().selfLogin, "first-user");
    await controller.observeShell("gh pr create", `${prUrl}\n`, true);
    fixture.login = "second-user";
    await controller.poll();
    assert.equal(controller.getState().selfLogin, "second-user");
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("reports malformed orchestration worker snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const coordinationRoot = join(root, "orchestrations");
  const directory = join(coordinationRoot, "parent-session");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "worker-session.json"), JSON.stringify({ version: 2, branch: "main" }));
  const controller = await createPrWatchController({
    sessionID: "parent",
    directory: "/repo",
    root,
    coordinationRoot,
    orchestrationID: "parent-session",
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    assert.match(controller.getState().lastError ?? "", /snapshot identity, schema, or PR coordinates do not match/);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("retains cached worker membership when the snapshot directory cannot be read", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const coordinationRoot = join(root, "orchestrations");
  const worker = await createPrWatchController({
    sessionID: "worker-session",
    directory: "/repo",
    root,
    coordinationRoot,
    workerOrchestrationID: "parent-session",
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  const parent = await createPrWatchController({
    sessionID: "parent",
    directory: "/repo",
    root,
    coordinationRoot,
    orchestrationID: "parent-session",
    wake: async () => undefined,
    exec: createExecutor(),
    isIdle: () => true,
  } as any);
  const snapshotDirectory = join(coordinationRoot, "parent-session");
  try {
    await worker.initialize();
    await worker.observeShell("gh pr create", `${prUrl}\n`, true);
    await parent.initialize();
    assert.equal(parent.getState().watchedPrs.length, 1);

    await rm(snapshotDirectory, { recursive: true });
    await writeFile(snapshotDirectory, "not a directory");
    await parent.poll();
    assert.equal(parent.getState().watchedPrs.length, 1);
    assert.match(parent.getState().lastError ?? "", /worker snapshots/);
  } finally {
    worker.dispose();
    parent.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("does not redeliver SHA completion when only run timestamps change", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-core-"));
  const fixture: { runs: unknown[] } = { runs: [] };
  const messages: string[] = [];
  const controller = await createPrWatchController({
    sessionID: "session-one",
    directory: "/repo",
    root,
    wake: async (message: string) => messages.push(message),
    exec: createExecutor(fixture),
    isIdle: () => true,
  } as any);
  try {
    await controller.initialize();
    await controller.observeShell("git push", "main -> main", true);
    fixture.runs = [
      {
        databaseId: 1,
        attempt: 1,
        name: "test",
        workflowName: "CI",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/eli0shin/repos/actions/runs/1",
        updatedAt: "2026-09-11T00:00:00Z",
      },
    ];
    await controller.poll();
    assert.equal(messages.length, 1);

    fixture.runs = [{ ...(fixture.runs[0] as object), updatedAt: "2026-09-11T00:01:00Z" }];
    await controller.poll();
    assert.equal(messages.length, 1);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
