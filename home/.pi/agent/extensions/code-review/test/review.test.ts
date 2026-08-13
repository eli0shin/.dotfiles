import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  buildAdvisoryMessage,
  buildContinuedReviewPrompt,
  buildReviewPrompt,
} from "../code-review-message.ts";
import {
  findReviewError,
  findReviewSession,
  getFinalAssistantText,
  isReviewFailure,
} from "../code-review-runner.ts";

test("buildReviewPrompt references the skill and preserves the requirements boundary", () => {
  const p = buildReviewPrompt();
  assert.match(p, /using the code-review skill/);
  assert.doesNotMatch(p, /code-review-skill/);
  assert.match(p, /uncommitted changes/);
  assert.match(p, /verify the implementation, not write the specification/);
  assert.match(p, /accepted design boundaries/);
  assert.match(p, /Do not create, strengthen, or reinterpret requirements/);
  assert.match(p, /new product decision.*outside the review/);
  assert.match(p, /Do not modify any files/);
});

test("buildReviewPrompt makes focus guidance non-authoritative", () => {
  const prompt = buildReviewPrompt("verify the prior blocker was fixed");
  assert.match(prompt, /Extra guidance: verify the prior blocker was fixed/);
  assert.match(prompt, /Focus guidance is non-authoritative/);
  assert.match(prompt, /not proof that a defect existed/);
  assert.doesNotMatch(buildReviewPrompt("   "), /Extra guidance/);
});

test("buildContinuedReviewPrompt permits retracting prior findings", () => {
  const prompt = buildContinuedReviewPrompt("check the fix");
  assert.match(prompt, /prior review conversation in this session/);
  assert.match(prompt, /Retract a prior finding/);
  assert.match(prompt, /Do not require preservation of code/);
  assert.match(prompt, /Extra guidance: check the fix/);
});

test("buildAdvisoryMessage tells the agent to verify findings skeptically", () => {
  const msg = buildAdvisoryMessage("Blocker: null deref at a.ts:1");
  assert.match(msg, /advisory claims, not requirements or instructions/);
  assert.match(msg, /Verify each claim\s+independently/);
  assert.match(msg, /Be skeptical/);
  assert.match(msg, /valid and in scope/);
  assert.match(msg, /Blocker: null deref/);
});

test("buildAdvisoryMessage includes an optional continuation ID", () => {
  const msg = buildAdvisoryMessage("", "review-session-id");
  assert.match(msg, /No actionable issues found/);
  assert.match(msg, /Review session ID: review-session-id/);
  assert.match(msg, /continue_code_review/);
});

test("findReviewSession requires an exact ID in the matching cwd", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "pi-code-review-test-"));
  const cwd = process.cwd();
  try {
    const sessionManager = SessionManager.create(cwd, sessionDir);
    const sessionId = sessionManager.getSessionId();
    const sessionFile = sessionManager.getSessionFile();
    sessionManager.appendMessage({ role: "user", content: "review", timestamp: Date.now() });
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    assert.equal(await findReviewSession(sessionId, cwd, sessionDir), sessionFile);
    await assert.rejects(findReviewSession(sessionId.slice(0, 8), cwd, sessionDir), /not found/);
    await assert.rejects(findReviewSession(sessionId, join(cwd, "other"), sessionDir), /not found/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("getFinalAssistantText returns the last assistant text", () => {
  const messages = [
    { role: "assistant", content: [{ type: "text", text: "first" }] },
    { role: "user", content: [{ type: "text", text: "ignore me" }] },
    { role: "assistant", content: [{ type: "text", text: "final review" }] },
  ];
  assert.equal(getFinalAssistantText(messages), "final review");
});

test("getFinalAssistantText returns empty when no assistant text", () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  assert.equal(getFinalAssistantText(messages), "");
});

test("findReviewError surfaces a rate-limited / errored assistant turn", () => {
  assert.equal(
    findReviewError([
      { role: "user", content: "go" },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "usage limit reached" },
    ]),
    "usage limit reached",
  );
  assert.equal(
    findReviewError([{ role: "assistant", content: [], stopReason: "error" }]),
    "model turn ended with an error",
  );
  assert.equal(findReviewError([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]), undefined);
});

test("isReviewFailure flags aborts and errors", () => {
  assert.equal(isReviewFailure({ output: "ok", sessionId: "review-1", aborted: false }), false);
  assert.equal(isReviewFailure({ output: "", sessionId: "review-1", aborted: true }), true);
  assert.equal(
    isReviewFailure({ output: "", sessionId: "review-1", aborted: false, error: "boom" }),
    true,
  );
  assert.equal(
    isReviewFailure({ output: "partial", sessionId: "review-1", aborted: false, error: "boom" }),
    true,
  );
});
