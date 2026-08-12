import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  atomicWriteJson,
  commandRequestPath,
  isFreshRegistration,
  readJson,
  sessionStatePath,
} from "../lib/pr-watch-ipc.ts";

test("IPC paths encode OpenCode session IDs", () => {
  const root = "/state/opencode/pr-watch";
  assert.equal(sessionStatePath(root, "session/one"), "/state/opencode/pr-watch/sessions/session%2Fone.json");
  assert.equal(
    commandRequestPath(root, "session/one", "request two"),
    "/state/opencode/pr-watch/commands/session%2Fone/request%20two.json",
  );
});

test("atomic JSON writes create parent directories and can be read", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-ipc-"));
  const path = join(root, "nested", "state.json");
  try {
    await atomicWriteJson(path, { version: 1, value: "ready" });
    assert.deepEqual(await readJson(path), { version: 1, value: "ready" });
    assert.match(await readFile(path, "utf8"), /\n$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registration freshness uses its heartbeat time", () => {
  assert.equal(isFreshRegistration({ updatedAt: 9_000 }, 10_000, 2_000), true);
  assert.equal(isFreshRegistration({ updatedAt: 7_999 }, 10_000, 2_000), false);
  assert.equal(isFreshRegistration({ updatedAt: Number.NaN }, 10_000, 2_000), false);
});
