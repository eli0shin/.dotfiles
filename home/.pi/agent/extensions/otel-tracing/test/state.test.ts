import assert from "node:assert/strict";
import test from "node:test";

import { createTracingLifecycle } from "../state.ts";

type FakeSpan = {
  id: string;
  name: string;
  attributes: Record<string, unknown>;
  parentSpanID: string | null;
  ended: boolean;
  status?: unknown;
  setAttribute: (key: string, value: unknown) => void;
  setStatus: (status: unknown) => void;
  end: () => void;
};

const createFakeSpanFactory = () => {
  const spans: FakeSpan[] = [];

  const startSpan = ({
    name,
    parentContext,
    attributes,
  }: {
    name: string;
    parentContext?: { span?: { id?: string } };
    attributes?: Record<string, unknown>;
  }) => {
    const span: FakeSpan = {
      id: `${name}-${spans.length + 1}`,
      name,
      attributes: { ...(attributes ?? {}) },
      parentSpanID: parentContext?.span?.id ?? null,
      ended: false,
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      setStatus(status) {
        this.status = status;
      },
      end() {
        this.ended = true;
      },
    };

    const context = { span };
    spans.push(span);
    return { span: span as never, context: context as never };
  };

  return { spans, startSpan };
};

const runtime = {
  sessionID: "session-1",
  sessionFile: "/tmp/session-1.jsonl",
  cwd: "/tmp/demo",
  userID: "eli",
};

test("nests llm and tool spans under the active user message", () => {
  const factory = createFakeSpanFactory();
  const lifecycle = createTracingLifecycle({
    startSpan: factory.startSpan as never,
    maxAttributeLength: 12_000,
  });

  lifecycle.activateSession(runtime);
  lifecycle.onInput({ source: "interactive" }, runtime, true);
  lifecycle.onBeforeAgentStart({ prompt: "Build this feature" }, runtime);
  lifecycle.onMessageStart({ role: "user", id: "user-1", content: [{ type: "text", text: "Build this feature" }] }, runtime);
  lifecycle.onTurnStart({ turnIndex: 1 }, runtime);
  lifecycle.onContext([{ role: "user", content: [{ type: "text", text: "Build this feature" }] }], "Be concise", runtime);
  lifecycle.onBeforeProviderRequest(
    {
      payload: { model: "claude-sonnet-4-5" },
      model: { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      contextUsage: { tokens: 42, contextWindow: 200_000, percent: 0.02 },
    },
    runtime,
  );
  lifecycle.onMessageUpdate({ type: "text_delta", delta: "Done" }, runtime);
  lifecycle.onMessageEnd(
    {
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      api: "anthropic-messages",
      stopReason: "toolUse",
      usage: {
        input: 10,
        output: 20,
        cacheRead: 1,
        cacheWrite: 0,
        totalTokens: 31,
        cost: { total: 0.12 },
      },
      content: [{ type: "text", text: "Done" }],
    },
    runtime,
  );
  lifecycle.onToolExecutionStart(
    {
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "pwd" },
    },
    runtime,
  );
  lifecycle.onToolResult(
    {
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "pwd" },
      content: [{ type: "text", text: "/tmp/demo" }],
      details: { exitCode: 0 },
      isError: false,
    },
    runtime,
  );
  lifecycle.onToolExecutionEnd(
    {
      toolCallId: "call-1",
      toolName: "bash",
      result: { exitCode: 0, output: "/tmp/demo" },
      isError: false,
    },
    runtime,
  );
  lifecycle.onAgentEnd({}, runtime);

  assert.deepEqual(
    factory.spans.map((span) => span.name),
    ["session", "user_message", "llm_call", "tool_call"],
  );
  assert.equal(factory.spans[1].parentSpanID, factory.spans[0].id);
  assert.equal(factory.spans[2].parentSpanID, factory.spans[1].id);
  assert.equal(factory.spans[3].parentSpanID, factory.spans[2].id);
  assert.equal(factory.spans[3].attributes["tool.name"], "bash");
  assert.equal(factory.spans[3].ended, true);
  assert.equal(factory.spans[2].ended, true);
  assert.equal(factory.spans[1].ended, true);
});

test("keeps the origin user span open for queued follow-ups and nests queued spans beneath it", () => {
  const factory = createFakeSpanFactory();
  const lifecycle = createTracingLifecycle({
    startSpan: factory.startSpan as never,
    maxAttributeLength: 12_000,
  });

  lifecycle.activateSession(runtime);
  lifecycle.onInput({ source: "interactive" }, runtime, true);
  lifecycle.onBeforeAgentStart({ prompt: "First request" }, runtime);
  lifecycle.onMessageStart({ role: "user", id: "user-1", content: [{ type: "text", text: "First request" }] }, runtime);

  lifecycle.onInput({ source: "interactive" }, runtime, false);
  lifecycle.onAgentEnd({}, runtime);

  const firstUser = factory.spans.find((span) => span.name === "user_message");
  assert.ok(firstUser);
  assert.equal(firstUser.ended, false);

  lifecycle.onBeforeAgentStart({ prompt: "Queued follow-up" }, runtime);
  lifecycle.onMessageStart({ role: "user", id: "user-2", content: [{ type: "text", text: "Queued follow-up" }] }, runtime);
  lifecycle.onAgentEnd({}, runtime);

  const queuedUser = factory.spans.find((span) => span.name === "queued_user_message");
  assert.ok(queuedUser);
  assert.equal(queuedUser.parentSpanID, firstUser.id);
  assert.equal(queuedUser.attributes["message.queued"], true);
  assert.equal(queuedUser.ended, true);
  assert.equal(firstUser.ended, true);
});

test("ends the session span on shutdown", () => {
  const factory = createFakeSpanFactory();
  const lifecycle = createTracingLifecycle({
    startSpan: factory.startSpan as never,
    maxAttributeLength: 12_000,
  });

  lifecycle.activateSession(runtime);
  lifecycle.onInput({ source: "interactive" }, runtime, true);
  lifecycle.onBeforeAgentStart({ prompt: "Do work" }, runtime);
  lifecycle.onAgentEnd({}, runtime);

  const session = factory.spans.find((span) => span.name === "session");
  assert.ok(session);
  assert.equal(session.ended, false);

  lifecycle.closeAll();
  assert.equal(session.ended, true);
});
