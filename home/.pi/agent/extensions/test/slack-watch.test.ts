import assert from "node:assert/strict";
import test from "node:test";

import slackWatch, { formatMessage, parseSlackTarget, selectNewMessages, type SlackMessage } from "../slack-watch.ts";

const CHANNEL = "C0B7X5NRH08";
const THREAD = "1793225566.021329";

test("parseSlackTarget resolves links and IDs", () => {
  assert.deepEqual(parseSlackTarget(CHANNEL), { channel: CHANNEL });
  assert.deepEqual(parseSlackTarget("D012ABCDEF"), { channel: "D012ABCDEF" });
  assert.deepEqual(parseSlackTarget(CHANNEL, "p1793225566021329"), { channel: CHANNEL, threadTs: THREAD });
  assert.deepEqual(parseSlackTarget(`https://acme.slack.com/archives/${CHANNEL}`), { channel: CHANNEL });
  assert.deepEqual(parseSlackTarget(`https://acme.slack.com/archives/${CHANNEL}/p1793225566021329`), {
    channel: CHANNEL,
    threadTs: THREAD,
  });
  // A reply link targets its parent thread.
  assert.deepEqual(
    parseSlackTarget(`https://acme.slack.com/archives/${CHANNEL}/p1793225759727899?thread_ts=${THREAD}&cid=${CHANNEL}`),
    { channel: CHANNEL, threadTs: THREAD },
  );
  assert.throws(() => parseSlackTarget("#sparky-operations"), /channel\/DM ID/);
  assert.throws(() => parseSlackTarget(CHANNEL, "yesterday"), /Not a Slack timestamp/);
});

test("selectNewMessages keeps newer messages, honors from, and skips progress updates", () => {
  const messages: SlackMessage[] = [
    { ts: "1.000002", user: "U2", text: "second" },
    { ts: "1.000000", user: "U1", text: "old" },
    { ts: "1.000001", user: "U1", text: "first" },
    { ts: "1.000003", bot_id: "B1", text: "On it", blocks: [{ type: "plan" }] },
    { ts: "1.000004", bot_id: "B1", text: "plan card", blocks: [{ type: "section" }, { type: "actions" }] },
  ];
  assert.deepEqual(selectNewMessages(messages, "1.000000").map((m) => m.ts), ["1.000001", "1.000002", "1.000004"]);
  assert.deepEqual(selectNewMessages(messages, "1.000000", "U1").map((m) => m.ts), ["1.000001"]);
  assert.deepEqual(selectNewMessages(messages, "1.000000", "B1").map((m) => m.ts), ["1.000004"]);
});

test("formatMessage names mentions and lists buttons", () => {
  const text = formatMessage(
    {
      ts: "1.000001",
      user: "U1",
      text: "<@U2> approve?",
      blocks: [
        {
          type: "actions",
          elements: [{ type: "button", text: { text: "Approve" }, action_id: "work_order_approve", value: "wo_1" }],
        },
      ],
    },
    [
      { id: "U1", real_name: "Sparky" },
      { id: "U2", real_name: "Eli" },
    ],
  );
  assert.equal(text, "[1.000001] Sparky:\n@Eli approve?\n[button] Approve  action_id=work_order_approve  value=wo_1");
});

function createHarness() {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<unknown> | unknown>();
  const tools = new Map<string, any>();
  const sent: Array<{ content: string; options: unknown }> = [];
  const saved: any[] = [];
  const execCalls: string[][] = [];
  let branch: unknown[] = [];
  let idle = true;
  let intervalCallback: (() => unknown) | undefined;
  // Thread replies by ts, as slackcli would return them.
  const replies: SlackMessage[] = [];
  let failure: string | undefined;

  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((callback: () => unknown) => {
    intervalCallback = callback;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.clearInterval = (() => {
    intervalCallback = undefined;
  }) as typeof clearInterval;

  const ctx = {
    isIdle: () => idle,
    ui: { setStatus() {}, notify() {}, theme: undefined },
    sessionManager: { getBranch: () => branch },
  };

  slackWatch({
    on(name: string, handler: any) {
      handlers.set(name, handler);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    appendEntry(customType: string, data: unknown) {
      saved.push(structuredClone(data));
      branch = [...branch, { type: "custom", customType, data: structuredClone(data) }];
    },
    sendMessage(message: { content: string }, options: unknown) {
      sent.push({ content: message.content, options });
    },
    async exec(command: string, args: string[]) {
      assert.equal(command, "slackcli");
      execCalls.push(args);
      if (failure) return { code: 1, stdout: "", stderr: `{"error":{"message":"${failure}"}}`, killed: false };
      const oldest = args.find((arg) => arg.startsWith("--oldest="))?.slice("--oldest=".length);
      const messages = oldest ? replies.filter((m) => Number(m.ts) > Number(oldest) && m.user !== "USELF") : [];
      const newest = replies.filter((m) => !oldest || Number(m.ts) > Number(oldest)).map((m) => m.ts).pop();
      return {
        code: 0,
        stdout: JSON.stringify({
          channel_id: CHANNEL,
          next_oldest: newest ?? oldest,
          messages,
          users: [{ id: "USPARKY", real_name: "Sparky" }],
        }),
        stderr: "",
        killed: false,
      };
    },
  } as any);

  return {
    ctx,
    sent,
    saved,
    execCalls,
    replies,
    tool: (name: string) => tools.get(name),
    handler: (name: string) => handlers.get(name),
    setIdle(value: boolean) {
      idle = value;
    },
    setFailure(value: string | undefined) {
      failure = value;
    },
    async tick() {
      await intervalCallback?.();
    },
    hasInterval: () => Boolean(intervalCallback),
    restore() {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    },
  };
}

async function watchThread(harness: ReturnType<typeof createHarness>, extra: Record<string, string> = {}) {
  await harness.handler("session_start")?.({ reason: "startup" }, harness.ctx);
  return harness.tool("watch_slack").execute(
    "1",
    { target: `https://acme.slack.com/archives/${CHANNEL}/p1793225566021329`, since: THREAD, ...extra },
    undefined,
    undefined,
    harness.ctx,
  );
}

test("a thread watch delivers new replies once, skipping your own", async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  const result = await watchThread(harness, { note: "Sparky FCC-1303" });
  assert.match(result.content[0].text, /Watching thread 1793225566\.021329 in C0B7X5NRH08/);
  assert.ok(harness.execCalls.some((args) => args.includes(`--thread-ts=${THREAD}`) && args.includes("--exclude-self")));

  harness.replies.push(
    { ts: "1793225600.000001", user: "USELF", text: "mine" },
    { ts: "1793225666.545569", user: "USPARKY", text: "Before I write the spec…" },
  );
  await harness.tick();
  assert.equal(harness.sent.length, 1);
  const [delivery] = harness.sent;
  assert.match(delivery.content, /^<slack-watch-harness-notification>/);
  assert.match(delivery.content, /New messages in thread 1793225566\.021329 in C0B7X5NRH08 \(Sparky FCC-1303\)/);
  assert.match(delivery.content, /\[1793225666\.545569\] Sparky:\nBefore I write the spec…/);
  assert.doesNotMatch(delivery.content, /mine/);
  assert.deepEqual(delivery.options, { triggerTurn: true });

  await harness.tick();
  assert.equal(harness.sent.length, 1, "already-delivered replies are not re-sent");
});

test("replies that arrive while busy wait until the agent settles", async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  await watchThread(harness);
  harness.setIdle(false);
  harness.replies.push({ ts: "1793225700.000001", user: "USPARKY", text: "one" });
  await harness.tick();
  harness.replies.push({ ts: "1793225700.000002", user: "USPARKY", text: "two" });
  await harness.tick();
  assert.equal(harness.sent.length, 0);

  harness.setIdle(true);
  await harness.handler("agent_settled")?.({}, harness.ctx);
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0].content, /one[\s\S]*two/);
});

test("a from filter ignores other authors", async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  await watchThread(harness, { from: "UOTHER" });
  harness.replies.push({ ts: "1793225700.000001", user: "USPARKY", text: "not them" });
  await harness.tick();
  assert.equal(harness.sent.length, 0);
});

test("unwatch stops polling and drops pending replies", async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  await watchThread(harness);
  harness.setIdle(false);
  harness.replies.push({ ts: "1793225700.000001", user: "USPARKY", text: "pending" });
  await harness.tick();
  const result = harness.tool("unwatch_slack").execute("2", { target: CHANNEL, thread_ts: THREAD }, undefined, undefined, harness.ctx);
  assert.match((await result).content[0].text, /Stopped watching C0B7X5NRH08\/1793225566\.021329[\s\S]*No Slack watches/);
  assert.equal(harness.hasInterval(), false);
  harness.setIdle(true);
  await harness.handler("agent_settled")?.({}, harness.ctx);
  assert.equal(harness.sent.length, 0);
});

test("watches survive a session restart and catch up on missed replies", async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  await watchThread(harness);
  harness.replies.push({ ts: "1793225700.000001", user: "USPARKY", text: "while closed" });
  await harness.handler("session_shutdown")?.({}, harness.ctx);
  await harness.handler("session_start")?.({ reason: "resume" }, harness.ctx);
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0].content, /while closed/);
});

test("a failed poll is reported in the watch list and clears on recovery", async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  await watchThread(harness);
  harness.setFailure("ratelimited");
  await harness.tick();
  assert.equal(harness.saved.at(-1).watches[0].lastError, "ratelimited");
  harness.setFailure(undefined);
  await harness.tick();
  assert.equal(harness.saved.at(-1).watches[0].lastError, undefined);
});

test("watch_slack rejects a conversation slackcli cannot read", async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  await harness.handler("session_start")?.({ reason: "startup" }, harness.ctx);
  harness.setFailure("Slack API error: thread_not_found");
  await assert.rejects(
    harness.tool("watch_slack").execute("1", { target: CHANNEL, thread_ts: THREAD }, undefined, undefined, harness.ctx),
    /thread_not_found/,
  );
});
