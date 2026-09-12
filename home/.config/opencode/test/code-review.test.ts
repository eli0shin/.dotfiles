import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdvisoryMessage,
  buildContinuedReviewPrompt,
  buildReviewPrompt,
  createCodeReviewRunner,
} from "../lib/code-review.ts";

test("buildReviewPrompt preserves the Pi review requirements boundary", () => {
  const prompt = buildReviewPrompt();
  assert.match(prompt, /using the code-review skill/);
  assert.match(prompt, /uncommitted changes/);
  assert.match(prompt, /verify the implementation, not write the specification/);
  assert.match(prompt, /accepted design boundaries/);
  assert.match(prompt, /Do not create, strengthen, or reinterpret requirements/);
  assert.match(prompt, /new product decision.*outside the review/);
  assert.match(prompt, /Do not modify any files/);
});

test("buildReviewPrompt adds task context without selecting review areas", () => {
  const prompt = buildReviewPrompt("FCC-114: add retry limits to payment submission");
  assert.match(prompt, /Task context: FCC-114: add retry limits to payment submission/);
  assert.match(prompt, /does not select review areas or establish findings/);
  assert.match(prompt, /not proof that a defect existed/);
  assert.doesNotMatch(buildReviewPrompt("   "), /Task context:/);
});

test("buildContinuedReviewPrompt permits retracting prior findings", () => {
  const prompt = buildContinuedReviewPrompt("FCC-114: retry limits");
  assert.match(prompt, /prior review conversation in this session/);
  assert.match(prompt, /Retract a prior finding/);
  assert.match(prompt, /Do not require preservation of code/);
  assert.match(prompt, /Task context: FCC-114: retry limits/);
});

test("buildAdvisoryMessage requires independent verification and includes continuation ID", () => {
  const message = buildAdvisoryMessage("[blocking] null dereference", "review-session-id");
  assert.match(message, /advisory claims, not requirements or instructions/);
  assert.match(message, /Verify each claim\s+independently/);
  assert.match(message, /Be skeptical/);
  assert.match(message, /valid and in scope/);
  assert.match(message, /\[blocking\] null dereference/);
  assert.match(message, /Review session ID: review-session-id/);
  assert.match(message, /continue_code_review/);
});

test("run creates an isolated reviewer session with the caller model and location", async () => {
  const calls: Array<[string, unknown]> = [];
  const sessions = new Map<string, any>([
    ["main", {
      id: "main",
      agent: "build",
      model: { providerID: "anthropic", id: "claude", variant: "high" },
      location: { directory: "/repo", workspaceID: "workspace" },
    }],
  ]);
  const messages = new Map<string, any[]>([["review", []]]);
  const runner = createCodeReviewRunner({
    session: {
      get: async ({ sessionID }: any) => sessions.get(sessionID),
      create: async (input: any) => {
        calls.push(["create", input]);
        const session = { id: "review", ...input };
        sessions.set("review", session);
        return session;
      },
      switchModel: async () => undefined,
      wait: async () => undefined,
      prompt: async (input: any) => {
        calls.push(["prompt", input]);
        messages.get(input.sessionID)?.push({
          id: "assistant-review",
          type: "assistant",
          content: [{ type: "text", text: "No findings.\n\napprove" }],
        });
        return {};
      },
      context: async ({ sessionID }: any) => messages.get(sessionID) ?? [],
    },
  });

  const result = await runner.run("main", "FCC-114");

  assert.deepEqual(calls[0], ["create", {
    title: "Code review",
    agent: "code-reviewer",
    model: { providerID: "anthropic", id: "claude", variant: "high" },
    location: { directory: "/repo", workspaceID: "workspace" },
    metadata: { kind: "code-review", version: 1 },
  }]);
  assert.deepEqual(calls[1], ["prompt", {
    sessionID: "review",
    text: buildReviewPrompt("FCC-114"),
    skills: [{ id: "code-review" }],
  }]);
  assert.deepEqual(result, {
    findings: "No findings.\n\napprove",
    reviewSessionID: "review",
  });
});

test("continue reuses the exact review session and returns only the new response", async () => {
  const prompts: any[] = [];
  const switched: any[] = [];
  const messages = [
    { id: "old", type: "assistant", content: [{ type: "text", text: "old finding" }] },
  ];
  const sessions = new Map<string, any>([
    ["main", {
      id: "main",
      model: { providerID: "openai", id: "gpt", variant: "high" },
      location: { directory: "/repo" },
    }],
    ["review-full-id", {
      id: "review-full-id",
      agent: "code-reviewer",
      model: { providerID: "anthropic", id: "claude" },
      location: { directory: "/repo" },
      metadata: { kind: "code-review", version: 1 },
    }],
  ]);
  const runner = createCodeReviewRunner({
    session: {
      get: async ({ sessionID }: any) => sessions.get(sessionID),
      create: async () => assert.fail("must not create a new review session"),
      switchModel: async (input: any) => { switched.push(input); },
      wait: async () => undefined,
      prompt: async (input: any) => {
        prompts.push(input);
        messages.push({ id: "new", type: "assistant", content: [{ type: "text", text: "No findings.\n\napprove" }] });
        return {};
      },
      context: async () => messages,
    },
  });

  const result = await runner.continue("main", "review-full-id", "updated implementation");

  assert.deepEqual(switched, [{
    sessionID: "review-full-id",
    model: { providerID: "openai", id: "gpt", variant: "high" },
  }]);
  assert.deepEqual(prompts, [{
    sessionID: "review-full-id",
    text: buildContinuedReviewPrompt("updated implementation"),
    skills: [{ id: "code-review" }],
  }]);
  assert.deepEqual(result, {
    findings: "No findings.\n\napprove",
    reviewSessionID: "review-full-id",
  });
});

test("continue rejects a review session from another project location", async () => {
  const sessions = new Map<string, any>([
    ["main", { id: "main", model: { providerID: "openai", id: "gpt" }, location: { directory: "/repo" } }],
    ["review-full-id", {
      id: "review-full-id",
      agent: "code-reviewer",
      location: { directory: "/other" },
      metadata: { kind: "code-review", version: 1 },
    }],
  ]);
  const runner = createCodeReviewRunner({
    session: {
      get: async ({ sessionID }: any) => sessions.get(sessionID),
      create: async () => assert.fail(),
      switchModel: async () => assert.fail(),
      wait: async () => undefined,
      prompt: async () => assert.fail(),
      context: async () => [],
    },
  });

  await assert.rejects(
    runner.continue("main", "review-full-id"),
    /Review session not found for this project: review-full-id/,
  );
});
