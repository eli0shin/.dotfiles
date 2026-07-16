import assert from "node:assert/strict";
import test from "node:test";

import prWatch, { pullRequestUrlFromText, shouldTrackActivity } from "../pr-watch.ts";

const humanActivity = { id: 1, user: { login: "reviewer", type: "User" } };
const botActivity = { id: 2, user: { login: "review-bot[bot]", type: "Bot" } };
const pr104Url = "https://github.com/eli0shin/repos/pull/104";
const pr105Url = "https://github.com/eli0shin/repos/pull/105";

type PrFixture = {
  number: number;
  url: string;
  branch: string;
  headSha: string;
  state: string;
  authorLogin: string;
};

function createHarness() {
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
      },
    ],
  ]);
  let intervalCallback: (() => unknown) | undefined;
  let idle = true;
  let branchEntries: unknown[] = [];

  function prNumberFromArgs(args: string[]): number | undefined {
    for (const arg of args) {
      const match = arg.match(/(?:pull\/)?(\d+)$/);
      if (match) return Number(match[1]);
    }
    return undefined;
  }

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
        return { code: 0, stdout: JSON.stringify({ nameWithOwner: "eli0shin/repos" }), stderr: "" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "view") {
        const pr = prs.get(prNumberFromArgs(args) ?? -1);
        if (!pr) return { code: 1, stdout: "", stderr: "no pull request found" };
        return {
          code: 0,
          stdout: JSON.stringify({
            number: pr.number,
            url: pr.url,
            headRefName: pr.branch,
            headRefOid: pr.headSha,
            state: pr.state,
            author: { login: pr.authorLogin },
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
      if (command === "gh" && args[0] === "api") {
        const number = Number(args[1]?.match(/\/(\d+)\//)?.[1]);
        const payload = args[1]?.includes("/reviews") ? reviews.get(number) ?? [] : [];
        return { code: 0, stdout: JSON.stringify(payload), stderr: "" };
      }
      if (command === "git" && args[0] === "rev-parse") {
        return { code: 0, stdout: "main-sha\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "run") {
        return { code: 0, stdout: "[]", stderr: "" };
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
    sessionManager: { getBranch: () => branchEntries },
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

  async function runPoll(): Promise<void> {
    assert.ok(intervalCallback, "polling interval was not registered");
    await withFakeTimer(() => intervalCallback?.());
  }

  async function startSession(): Promise<void> {
    await withFakeTimer(() => handlers.get("session_start")?.({}, ctx));
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
    prs,
    ctx,
    activate,
    runPoll,
    startSession,
    settleAgent,
    shutdown,
    setIdle(value: boolean) {
      idle = value;
    },
    setBranchEntries(entries: unknown[]) {
      branchEntries = entries;
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

test("ignores activities without an id", () => {
  assert.equal(shouldTrackActivity("issue-comment", { user: { login: "reviewer" } }), false);
  assert.equal(shouldTrackActivity("review", { user: { login: "review-bot[bot]" } }), false);
  assert.equal(shouldTrackActivity("review-comment", {}), false);
});

test("uses the last PR URL in command output", () => {
  assert.equal(pullRequestUrlFromText(`${pr104Url}\n${pr105Url}\n`), pr105Url);
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

test("CI notification identifies the watched branch", async () => {
  const harness = createHarness();
  await harness.activate(104);
  harness.checks.set(104, [terminalCheck("104")]);

  await harness.runPoll();
  await harness.shutdown();

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0] ?? "", /CI finished for branch remove-collapse-command \(PR #104\)/);
  assert.match(harness.sentMessages[0] ?? "", /Branch: remove-collapse-command/);
});

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

test("only the latest state entry is considered and version 2 is not migrated", async () => {
  const harness = createHarness();
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 3,
        mode: "paused",
        watchedPrs: [],
        pendingPrUpdates: [],
        recentGhOutputs: [],
      },
    },
    {
      type: "custom",
      customType: "pr-watch-state",
      data: { version: 2, enabled: true, active: true, watchedPrs: [{ pr: { number: 104 } }] },
    },
  ]);

  await harness.startSession();

  assert.equal(harness.savedStates.at(-1)?.version, 3);
  assert.equal(harness.savedStates.at(-1)?.mode, "active");
  assert.deepEqual(harness.savedStates.at(-1)?.watchedPrs, []);
});

test("version 3 paused pending state survives session restart", async () => {
  const harness = createHarness();
  const pr = harness.prs.get(104)!;
  harness.reviews.set(104, [{ id: 77, user: { login: "reviewer", type: "User" } }]);
  harness.setBranchEntries([
    {
      type: "custom",
      customType: "pr-watch-state",
      data: {
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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

  const secondHarness = createHarness();
  await secondHarness.activate(104);
  await secondHarness.commands.get("pr-watch")?.handler("pause", secondHarness.ctx);
  secondHarness.checks.set(104, [terminalCheck("104")]);
  await secondHarness.runPoll();
  await secondHarness.commands.get("pr-watch")?.handler("remove 104", secondHarness.ctx);
  assert.deepEqual(secondHarness.savedStates.at(-1)?.pendingPrUpdates, []);
});
