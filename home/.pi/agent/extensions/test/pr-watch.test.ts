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
  const savedStates: any[] = [];
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
    sendUserMessage(message: string): void {
      sentMessages.push(message);
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
    ui: { notify(): void {}, setStatus(): void {} },
    isIdle: () => true,
    sessionManager: { getBranch: () => [] },
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

  async function shutdown(): Promise<void> {
    await withFakeTimer(() => handlers.get("session_shutdown")?.({}, ctx));
  }

  return { handlers, commands, execCalls, sentMessages, savedStates, reviews, checks, prs, ctx, activate, runPoll, shutdown };
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
