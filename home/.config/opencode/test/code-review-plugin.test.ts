import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../plugins/code-review/index.ts";

test("the code review plugin registers controlled review tools and restricts reviewer tools", async () => {
  const tools = new Map<string, any>();
  let contextHook: ((event: any) => void) | undefined;
  const sessions = new Map<string, any>([
    ["main", {
      id: "main",
      agent: "build",
      model: { providerID: "anthropic", id: "claude", variant: "high" },
      location: { directory: "/repo" },
    }],
  ]);
  const messages = new Map<string, any[]>();
  const rpc: any = () => undefined;
  rpc.register = async () => ({ dispose: async () => undefined, events: { emit: async () => undefined } });
  const context = {
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({ add: (tool: any) => tools.set(tool.name, tool) });
        return { dispose: async () => undefined };
      },
    },
    session: {
      hook: async (name: string, callback: (event: any) => void) => {
        if (name === "context") contextHook = callback;
        return { dispose: async () => undefined };
      },
      get: async ({ sessionID }: any) => sessions.get(sessionID),
      create: async (input: any) => {
        const review = { id: "review-session", ...input };
        sessions.set(review.id, review);
        messages.set(review.id, []);
        return review;
      },
      switchModel: async () => undefined,
      wait: async () => undefined,
      prompt: async ({ sessionID }: any) => {
        messages.get(sessionID)?.push({
          id: "review-response",
          type: "assistant",
          content: [{ type: "text", text: "No findings.\n\napprove" }],
        });
        return {};
      },
      context: async ({ sessionID }: any) => messages.get(sessionID) ?? [],
      interrupt: async () => undefined,
    },
    rpc,
  };

  const cleanup = await (plugin.setup as any)(context);
  try {
    assert.deepEqual([...tools.keys()], ["run_code_review", "continue_code_review"]);
    assert.deepEqual(tools.get("run_code_review").options, { codemode: false });
    assert.deepEqual(tools.get("continue_code_review").options, { codemode: false });
    assert.ok(contextHook);
    const schemas = {
      read: {}, grep: {}, glob: {}, shell: {}, websearch: {}, webfetch: {}, skill: {},
      edit: {}, question: {}, subagent: {}, run_code_review: {}, continue_code_review: {}, execute: {},
    };
    contextHook({ agent: "code-reviewer", tools: schemas });
    assert.deepEqual(Object.keys(schemas), ["read", "grep", "glob", "shell", "websearch", "webfetch", "skill"]);

    const result = await tools.get("run_code_review").execute(
      { taskContext: "implement FCC-114" },
      { sessionID: "main", agent: "build", progress: async () => undefined },
    );
    assert.match(result.content[0].text, /advisory claims/);
    assert.match(result.content[0].text, /Review session ID: review-session/);
    assert.equal(result.metadata.reviewSessionID, "review-session");

    await assert.rejects(
      tools.get("run_code_review").execute(
        {},
        { sessionID: "review-session", agent: "code-reviewer", progress: async () => undefined },
      ),
      /reviewer cannot start or continue code reviews/i,
    );
  } finally {
    await cleanup?.();
  }
});
