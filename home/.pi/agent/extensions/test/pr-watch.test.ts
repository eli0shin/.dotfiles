import assert from "node:assert/strict";
import test from "node:test";

import { shouldTrackActivity } from "../pr-watch.ts";

const humanActivity = { id: 1, user: { login: "reviewer", type: "User" } };
const botActivity = { id: 2, user: { login: "review-bot[bot]", type: "Bot" } };

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
