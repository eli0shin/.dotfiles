import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdvisoryMessage, buildReviewPrompt } from "../review-message.ts";
import { findReviewError, getFinalAssistantText, isReviewFailure } from "../review-runner.ts";

test("buildReviewPrompt references the skill and read-only intent", () => {
  const p = buildReviewPrompt();
  assert.match(p, /code-review-skill/);
  assert.match(p, /uncommitted changes/);
  assert.match(p, /Do not modify any files/);
});

test("buildReviewPrompt appends focus guidance", () => {
  assert.match(buildReviewPrompt("watch migrations"), /Extra guidance: watch migrations/);
  assert.doesNotMatch(buildReviewPrompt("   "), /Extra guidance/);
});

test("buildAdvisoryMessage frames findings as advisory", () => {
  const msg = buildAdvisoryMessage("Blocker: null deref at a.ts:1");
  assert.match(msg, /ADVISORY/);
  assert.match(msg, /not direct instructions/);
  assert.match(msg, /Blocker: null deref/);
});

test("buildAdvisoryMessage handles empty findings", () => {
  assert.match(buildAdvisoryMessage(""), /No actionable issues found/);
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
  assert.equal(isReviewFailure({ output: "ok", aborted: false }), false);
  assert.equal(isReviewFailure({ output: "", aborted: true }), true);
  assert.equal(isReviewFailure({ output: "", aborted: false, error: "boom" }), true);
  assert.equal(isReviewFailure({ output: "partial", aborted: false, error: "boom" }), true);
});
