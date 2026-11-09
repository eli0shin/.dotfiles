import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import autoSessionName, { cleanTitle, namingContext, namingModel } from "../auto-session-name.ts";

const model = (id: string, input = 0, output = 0, provider = "test"): Model<Api> => ({
  id, provider, name: id, api: "openai-completions", baseUrl: "https://unused.invalid", reasoning: false,
  input: ["text"], cost: { input, output, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
});
const main = model("large", 5, 20), small = model("small", 0.2, 1);
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const response = (title: string) => ({ content: [{ type: "text", text: title }], stopReason: "stop" });

type Handler = (event: any, ctx: ExtensionContext) => unknown;
function harness(manager = SessionManager.inMemory(), mode = "tui") {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { handler: Handler }>();
  const calls: { model: Model<Api>; context: any; options: any }[] = [];
  let completion: () => Promise<any> = async () => response("Fix Login Redirects");
  const ctx = {
    mode, model: main, sessionManager: manager,
    modelRegistry: {
      getAll: () => [main, small],
      streamSimple: (model: Model<Api>, context: unknown, options: unknown) => {
        calls.push({ model, context, options });
        return { result: () => completion() };
      },
    },
    ui: { notify: () => {} },
  } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
    appendEntry: (type: string, data: any) => manager.appendCustomEntry(type, data),
    getSessionName: () => manager.getSessionName(),
    setSessionName: (name: string) => {
      manager.appendSessionInfo(name);
      void emit("session_info_changed", { name });
    },
  } as unknown as ExtensionAPI;
  async function emit(event: string, data: any = {}) {
    for (const handler of handlers.get(event) ?? []) await handler(data, ctx);
  }
  autoSessionName(pi);
  return {
    manager, pi, ctx, calls, emit,
    start: () => emit("session_start"),
    async user(content: string) {
      const message = { role: "user" as const, content, timestamp: Date.now() };
      await emit("message_end", { message }); // Match Pi: extension first, persistence second.
      manager.appendMessage(message);
      await tick();
    },
    answer(content: string) {
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: content }], timestamp: Date.now() } as any);
    },
    command: (action: string) => commands.get("auto-name")!.handler(action, ctx),
    complete: (fn: () => Promise<any>) => { completion = fn; },
  };
}

test("selects a cheap model from the selected provider, including new families and zero-priced bridges", () => {
  assert.equal(namingModel(main, [main, small, model("nano", 0.001, 0.001, "other")]), small);
  const luna = model("gpt-6-luna", 0.1, 0.5);
  assert.equal(namingModel(main, [main, luna]), luna);
  const haiku = model("claude-haiku-4-5");
  assert.equal(namingModel(main, [main, haiku]), haiku);
  assert.equal(namingModel(main, []), main);
});

test("normalizes titles and rejects prose, controls, JSON and oversized answers", () => {
  assert.equal(cleanTitle('Title: "Fix Login Redirects"'), "Fix Login Redirects");
  for (const value of ["", "First line\nsecond line", "\x1b]0;bad", '{"title":"Fix login"}', "a".repeat(33), "Fix Safari OAuth Redirect Loop"]) assert.equal(cleanTitle(value), undefined);
});

test("names after the first prompt, reassesses two and three with assistant context, then stops", async () => {
  const h = harness();
  await h.start();
  await h.user("Use the debugging skill");
  assert.equal(h.pi.getSessionName(), "Fix Login Redirects");
  assert.equal(h.calls[0].model.id, "small");
  h.answer("The actual issue is a login redirect loop in Safari.");
  h.complete(async () => response("Fix Safari Login Redirects"));
  await h.user("It's Safari specifically, not Chrome");
  assert.equal(h.pi.getSessionName(), "Fix Safari Login Redirects");
  const request: string = h.calls[1].context.messages[0].content[0].text;
  assert.match(request, /WHOLE conversation[^\n]*$/, "the task must be restated after the conversation");
  const second = JSON.parse(request.slice(0, request.lastIndexOf("\n\n")));
  assert.equal(second.currentTitle, undefined, "the old title must not anchor the new one");
  assert.match(second.conversation, /actual issue/);
  assert.match(h.calls[1].context.systemPrompt, /WHOLE CONVERSATION/);
  await h.user("Keep the existing OAuth flow");
  await h.user("Run tests and merge");
  assert.equal(h.calls.length, 3);
  const names = h.manager.getEntries().filter(e => e.type === "session_info");
  assert.equal(names.length, 2, "keeping a correct title must not append redundant renames");
  await h.emit("session_shutdown");
});

test("repairs an overlong model answer once and never installs a five-word name", async () => {
  const h = harness(); await h.start();
  let requests = 0;
  h.complete(async () => response(requests++ === 0 ? "Safari OAuth Redirect Loop Fix" : "Safari OAuth Loop"));
  await h.user("Fix Safari OAuth redirects");
  assert.equal(h.pi.getSessionName(), "Safari OAuth Loop");
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].context.systemPrompt, /exactly 3 words/);
  await h.emit("session_shutdown");
  const invalid = harness(); await invalid.start();
  invalid.complete(async () => response("Safari OAuth Redirect Loop Fix"));
  await invalid.user("Fix redirects");
  assert.equal(invalid.pi.getSessionName(), undefined);
  assert.equal(invalid.calls.length, 2, "repairs must be bounded");
  await invalid.emit("session_shutdown");
});

test("reload shortens older automatic names that exceed four words without touching manual names", async () => {
  const manager = SessionManager.inMemory();
  const id = manager.appendMessage({ role: "user", content: "Fix Safari OAuth redirects", timestamp: 1 });
  const title = "Safari OAuth Redirect Loop Fix";
  manager.appendCustomEntry("dotfiles.auto-session-name", { title, checkpoint: id });
  manager.appendSessionInfo(title);
  const h = harness(manager);
  h.complete(async () => response("Safari OAuth Loop"));
  await h.start(); await tick();
  assert.equal(h.pi.getSessionName(), "Safari OAuth Loop");
  assert.equal(h.calls.length, 1);
  await h.emit("session_shutdown");
  const manualManager = SessionManager.inMemory();
  manualManager.appendSessionInfo(title);
  const manual = harness(manualManager);
  await manual.start(); await manual.user("Fix redirects");
  assert.equal(manual.pi.getSessionName(), title);
  assert.equal(manual.calls.length, 0);
  await manual.emit("session_shutdown");
});

test("checkpoint survives reload and unnamed existing sessions get backfilled", async () => {
  const first = harness();
  await first.start(); await first.user("Fix login redirects");
  await first.emit("session_shutdown");
  const resumed = harness(first.manager);
  await resumed.start(); await tick();
  assert.equal(resumed.calls.length, 0);
  await resumed.user("For Safari too");
  assert.equal(resumed.calls.length, 1);
  await resumed.emit("session_shutdown");
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "Fix login redirects", timestamp: 1 });
  const old = harness(manager);
  await old.start(); await tick();
  assert.equal(old.pi.getSessionName(), "Fix Login Redirects");
  await old.emit("session_shutdown");
});

test("preexisting and manual names win, including renames during an outstanding request", async () => {
  const h = harness();
  await h.start();
  let finish: (value: any) => void;
  h.complete(() => new Promise(resolve => { finish = resolve; }));
  await h.user("Fix redirects");
  h.pi.setSessionName("My deliberate name");
  finish!(response("An Unwanted Rename"));
  await tick();
  assert.equal(h.pi.getSessionName(), "My deliberate name");
  await h.user("Another detail");
  assert.equal(h.calls.length, 1);
  await h.emit("session_shutdown");
  const resumed = harness(h.manager);
  await resumed.start(); await resumed.user("A third detail");
  assert.equal(resumed.calls.length, 0);
  resumed.complete(async () => response("Fix Login Redirects"));
  await resumed.command("now");
  assert.equal(resumed.pi.getSessionName(), "Fix Login Redirects");
  await resumed.emit("session_shutdown");
  const m = SessionManager.inMemory(); m.appendSessionInfo("Worker task");
  const named = harness(m); await named.start(); await named.user("Do work");
  assert.equal(named.calls.length, 0); await named.emit("session_shutdown");
});

test("clearing a manual name remains manual until explicitly reenabled", async () => {
  const h = harness(); await h.start(); await h.user("Fix redirects");
  h.pi.setSessionName("");
  await h.user("For Safari");
  assert.equal(h.calls.length, 1);
  assert.equal(h.pi.getSessionName(), undefined);
  await h.emit("session_shutdown");
  const resumed = harness(h.manager); await resumed.start(); await tick();
  assert.equal(resumed.calls.length, 0);
  await resumed.command("on");
  assert.equal(resumed.pi.getSessionName(), "Fix Login Redirects");
  await resumed.emit("session_shutdown");
});

test("late results cannot rename a replaced session or overwrite a newer naming request", async () => {
  const h = harness(); await h.start();
  let finish: (value: any) => void;
  h.complete(() => new Promise(resolve => { finish = resolve; }));
  await h.user("A vague first message");
  const signal = h.calls[0].options.signal;
  h.complete(async () => response("Fix Safari Login Redirects"));
  await h.user("Specifically Safari login redirects");
  assert.equal(signal.aborted, true);
  finish!(response("A Vague Title")); await tick();
  assert.equal(h.pi.getSessionName(), "Fix Safari Login Redirects");
  let afterExit: (value: any) => void;
  h.complete(() => new Promise(resolve => { afterExit = resolve; }));
  await h.user("A third message");
  await h.emit("session_shutdown");
  afterExit!(response("Wrong Session Name")); await tick();
  assert.equal(h.pi.getSessionName(), "Fix Safari Login Redirects");
});

test("failures stay nonfatal and can retry; background runs are not named", async () => {
  const h = harness(); await h.start();
  h.complete(async () => { throw new Error("Unavailable"); });
  await h.user("Fix redirects");
  assert.equal(h.pi.getSessionName(), undefined);
  h.complete(async () => response("Fix Login Redirects"));
  await h.user("In Safari");
  assert.equal(h.pi.getSessionName(), "Fix Login Redirects");
  await h.emit("session_shutdown");
  for (const mode of ["print", "json"]) {
    const quiet = harness(undefined, mode); await quiet.start(); await quiet.user("Test");
    assert.equal(quiet.calls.length, 0); await quiet.emit("session_shutdown");
  }
});

test("context excludes system, tool outputs, thinking and harness notifications and keeps messages whole", () => {
  const h = harness();
  h.manager.appendMessage({ role: "user", content: "😀".repeat(10000), timestamp: 1 });
  h.answer("actual answer");
  h.manager.appendMessage({ role: "assistant", content: [{ type: "thinking", thinking: "private thoughts" }], timestamp: 1 } as any);
  h.manager.appendMessage({ role: "toolResult", content: [{ type: "text", text: "secret tool output" }], timestamp: 1 } as any);
  h.manager.appendMessage({ role: "user", content: "<worker-message>notification</worker-message>", timestamp: 1 });
  h.manager.appendCustomMessageEntry("watch", "unrelated notification", true);
  const result = namingContext(h.manager.getBranch());
  assert.equal(result.count, 1);
  assert.ok(result.conversation.includes("😀".repeat(10000)), "messages must never be truncated");
  assert.match(result.conversation, /actual answer/);
  assert.doesNotMatch(result.conversation, /private|secret|notification/);
});
