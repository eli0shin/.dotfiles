import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { recordSubscriptionLimit } from "../claude-bridge/src/rate-limit.ts";
import usageLimitResume from "../usage-limit-resume/index.ts";
import { CONTINUATION_TYPE, RESUME_GRACE_MS, STATE_TYPE } from "../usage-limit-resume/state.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const MODEL = { provider: "claude-bridge", id: "claude-test" };

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  t.mock.method(Math, "random", () => 0);
  const dir = mkdtempSync(join(tmpdir(), "pi-usage-resume-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  return dir;
}

function assistant(message: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant", api: "claude-bridge", provider: MODEL.provider, model: MODEL.id,
    timestamp: Date.now(), content: [], stopReason: "error", errorMessage: "Claude quota exceeded — rate limit",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    ...message,
  };
}

function harness(manager = SessionManager.inMemory()) {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  const sent: Array<{ message: any; options: unknown }> = [];
  let idle = true;
  const ctx = {
    mode: "tui",
    model: MODEL,
    sessionManager: manager,
    ui: { notify() {}, setStatus() {} },
    isIdle: () => idle,
  };
  const handle = (event: string, data: unknown = {}) => handlers.get(event)?.(data, ctx);
  usageLimitResume({
    on: (event: string, callback: (event: any, ctx: unknown) => unknown) => handlers.set(event, callback),
    appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
    registerMessageRenderer: () => {},
    registerCommand: (name: string, command: any) => commands.set(name, command),
    sendMessage(message: any, options: unknown) {
      sent.push({ message, options });
      handle("before_agent_start", { messageType: "custom", message });
      manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    },
  } as unknown as ExtensionAPI);
  handle("session_start", { reason: "startup" });

  function fail(resetAt?: number, window = "five_hour", aborted = false) {
    const response = assistant();
    if (resetAt !== undefined) recordSubscriptionLimit(response, { status: "rejected", rateLimitType: window, resetsAt: resetAt / 1000 });
    manager.appendMessage(response);
    const entries = handle("agent_before_settle", { outcome: "error", entries: [] })?.entries ?? [];
    for (const e of entries) manager.appendCustomEntry(e.customType, e.data);
    handle("agent_settled", { aborted });
  }
  return { ctx, handle, sent, manager, fail, setIdle: (value: boolean) => { idle = value; },
    cancel: () => commands.get("cancel-usage-limit-resume")!.handler("", ctx) };
}

test("Pi arms from the settled provider error and resumes with the previous tool result in context", async (t) => {
  const dir = setup(t);
  let requests = 0;
  let toolRuns = 0;
  const marker = join(dir, "marker.txt");
  writeFileSync(marker, "content of the previous tool result");
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, extensionFactories: [usageLimitResume, (pi) => {
    pi.registerProvider(MODEL.provider, {
      api: "claude-bridge", apiKey: "offline-fixture", baseUrl: "http://127.0.0.1:1",
      models: [{ id: MODEL.id, name: MODEL.id, input: ["text"], reasoning: false, contextWindow: 128_000,
        maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      streamSimple(_model, context) {
        const stream = createAssistantMessageEventStream();
        const request = ++requests;
        if (request === 1) {
          const message = assistant({ stopReason: "toolUse", errorMessage: undefined, content: [
            { type: "toolCall", id: "read-once", name: "read", arguments: { path: marker } },
          ] });
          stream.push({ type: "done", reason: "toolUse", message });
        } else if (request === 2) {
          const error = assistant();
          recordSubscriptionLimit(error, { status: "rejected", rateLimitType: "five_hour", resetsAt: (NOW + HOUR) / 1000 });
          stream.push({ type: "error", reason: "error", error });
        } else {
          assert.equal(request, 3);
          const last = context.messages.at(-1);
          assert.equal(last?.role, "user");
          assert.deepEqual(last.content, [{ type: "text", text: "Continue." }]);
          assert.ok(context.messages.some((entry) => entry.role === "toolResult" &&
            entry.content.some((block) => block.type === "text" && block.text.includes("content of the previous tool result"))));
          const message = assistant({ stopReason: "stop", errorMessage: undefined, content: [{ type: "text", text: "continued" }] });
          stream.push({ type: "done", reason: "stop", message });
        }
        return stream;
      },
    });
    pi.on("tool_result", () => { toolRuns++; });
  }] });
  await loader.reload();
  const manager = SessionManager.inMemory(dir);
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader,
    settingsManager: SettingsManager.inMemory(), sessionManager: manager });
  try {
    await session.bindExtensions({ mode: "tui", onError: ({ error }) => assert.fail(error) });
    await session.setModel(session.modelRuntime.getModel(MODEL.provider, MODEL.id)!);
    session.setActiveToolsByName(["read"]);
    await session.prompt("Start work");
    assert.equal(requests, 2);
    assert.equal(toolRuns, 1);
    assert.ok(manager.getBranch().some((entry) => entry.type === "custom" && entry.customType === STATE_TYPE && entry.data));
    t.mock.timers.tick(HOUR + RESUME_GRACE_MS);
    await session.waitForIdle();
    assert.equal(session.getLastAssistantText(), "continued");
    assert.equal(requests, 3);
    assert.equal(toolRuns, 1);
  } finally {
    session.dispose();
  }
});

test("automatically continues a weekly Claude limit, with a labeled turn containing only Continue", (t) => {
  setup(t);
  const app = harness();
  const delay = 7 * 24 * HOUR;
  app.fail(NOW + delay, "seven_day_opus");
  app.manager.appendCustomEntry("pr-watch-state", { unrelated: true });
  t.mock.timers.tick(delay + RESUME_GRACE_MS - 1);
  assert.equal(app.sent.length, 0);
  t.mock.timers.tick(1);
  assert.equal(app.sent.length, 1);
  assert.equal(app.sent[0]!.message.customType, CONTINUATION_TYPE);
  assert.equal(app.sent[0]!.message.content, "Continue.");
  assert.equal(app.sent[0]!.message.display, true);
  assert.deepEqual(app.sent[0]!.options, { triggerTurn: true });
  t.mock.timers.tick(delay);
  assert.equal(app.sent.length, 1);
});

test("allows one retry at the same expired reset, then stops", (t) => {
  setup(t);
  const app = harness();
  app.fail(NOW + HOUR);
  t.mock.timers.tick(HOUR + RESUME_GRACE_MS);
  app.fail(NOW + HOUR);
  t.mock.timers.tick(RESUME_GRACE_MS);
  app.fail(NOW + HOUR);
  t.mock.timers.tick(HOUR);
  assert.deepEqual(app.sent.map(({ message }) => message.details.attempt), [1, 2]);
});

test("a different blocking window can re-arm an automatic continuation, but the episode is capped", (t) => {
  setup(t);
  const app = harness();
  for (let i = 0; i < 4; i++) {
    app.fail(Date.now() + HOUR, i === 0 ? "five_hour" : "seven_day");
    t.mock.timers.tick(HOUR + RESUME_GRACE_MS);
  }
  assert.deepEqual(app.sent.map(({ message }) => message.details.attempt), [1, 2, 3]);
});

test("does not schedule generic, stale, or aborted errors, or run in RPC mode", (t) => {
  setup(t);
  const app = harness();
  app.fail();
  app.fail(NOW - HOUR);
  app.fail(NOW + HOUR, "five_hour", true);
  app.ctx.mode = "rpc";
  app.fail(NOW + HOUR);
  t.mock.timers.tick(2 * HOUR);
  assert.equal(app.sent.length, 0);
});

test("the config can disable the default Claude bridge resume", (t) => {
  const dir = setup(t);
  writeFileSync(join(dir, "usage-limit-resume.json"), '{"providers":[]}');
  const app = harness();
  app.fail(NOW + HOUR);
  t.mock.timers.tick(2 * HOUR);
  assert.equal(app.sent.length, 0);
});

for (const stop of ["prompt", "model", "tree", "cancel", "quit"] as const) {
  test(`${stop} invalidates the pending wait and cannot re-arm it on restore`, async (t) => {
    setup(t);
    const app = harness();
    app.fail(NOW + HOUR);
    if (stop === "prompt") app.handle("before_agent_start", { messageType: "user" });
    if (stop === "tree") app.handle("session_before_tree");
    if (stop === "model") {
      app.ctx.model = { provider: MODEL.provider, id: "different" };
      app.handle("model_select");
      app.ctx.model = MODEL;
    }
    if (stop === "cancel") await app.cancel();
    if (stop === "quit") app.handle("session_shutdown", { reason: "quit" });
    const restored = harness(app.manager);
    t.mock.timers.tick(2 * HOUR);
    assert.equal(app.sent.length, 0);
    assert.equal(restored.sent.length, 0);
  });
}

test("restores an armed wait after reload and never dispatches a consumed reservation again", (t) => {
  setup(t);
  const old = harness();
  old.fail(NOW + HOUR);
  old.handle("session_shutdown", { reason: "reload" });
  const reloaded = harness(old.manager);
  t.mock.timers.tick(HOUR + RESUME_GRACE_MS);
  assert.equal(old.sent.length, 0);
  assert.equal(reloaded.sent.length, 1);
  const consumed = reloaded.manager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === STATE_TYPE).at(-1);
  assert.ok(consumed?.type === "custom" && consumed.data === null);
  reloaded.handle("session_shutdown", { reason: "reload" });
  const again = harness(old.manager);
  t.mock.timers.tick(HOUR);
  assert.equal(again.sent.length, 0);
});

test("defers while Pi is busy or waiting for user input", (t) => {
  setup(t);
  const app = harness();
  app.fail(NOW + HOUR);
  app.setIdle(false);
  t.mock.timers.tick(HOUR + RESUME_GRACE_MS);
  assert.equal(app.sent.length, 0);
  app.setIdle(true);
  app.handle("ui_prompt_start");
  t.mock.timers.tick(1000);
  assert.equal(app.sent.length, 0);
  app.handle("ui_prompt_end");
  t.mock.timers.tick(1000);
  assert.equal(app.sent.length, 1);
});
