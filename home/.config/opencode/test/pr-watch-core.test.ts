import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPrWatchController } from "../lib/pr-watch-core.ts";

const prUrl = "https://github.com/eli0shin/repos/pull/104";

function createExecutor(options: {
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  checks?: unknown[];
  reviews?: unknown[];
} = {}) {
  return async (command: string, args: string[]) => {
    if (command === "gh" && args[0] === "repo") return { code: 0, stdout: JSON.stringify({ nameWithOwner: "eli0shin/repos" }), stderr: "" };
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
          state: "OPEN",
          author: { login: "eli0shin" },
          mergeable: options.mergeable ?? "MERGEABLE",
        }),
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") return { code: 0, stdout: JSON.stringify(options.checks ?? []), stderr: "" };
    if (command === "gh" && args[0] === "api" && args[1] === "user") return { code: 0, stdout: JSON.stringify({ login: "eli0shin" }), stderr: "" };
    if (command === "gh" && args[0] === "api" && args[1]?.includes("/commits/")) return { code: 0, stdout: JSON.stringify({ sha: "main-sha" }), stderr: "" };
    if (command === "gh" && args[0] === "api") {
      return { code: 0, stdout: JSON.stringify(args[1]?.endsWith("/reviews?per_page=100") ? options.reviews ?? [] : []), stderr: "" };
    }
    if (command === "gh" && args[0] === "run") return { code: 0, stdout: "[]", stderr: "" };
    if (command === "git" && args[0] === "branch") return { code: 0, stdout: "main\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unsupported command" };
  };
}

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
  const fixture: { checks: unknown[]; reviews: unknown[] } = { checks: [], reviews: [] };
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

    idle = true;
    await controller.flushPending();
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? "", /^<pr-watch-harness-notification>/);
    assert.match(messages[0] ?? "", /CI finished/);
    assert.match(messages[0] ?? "", /review feedback/);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
