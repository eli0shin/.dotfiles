import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { atomicWriteJson, registrationPath, sessionStatePath, stateRoot } from "../lib/pr-watch-ipc.ts";
import plugin from "../plugins/orchestrator/index.ts";

test("OpenCode appends the canonical orchestrator role only to parent sessions", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-orchestrator-"));
  const oldHome = process.env.HOME;
  const oldStateHome = process.env.XDG_STATE_HOME;
  process.env.HOME = home;
  process.env.XDG_STATE_HOME = join(home, "state");
  const skillPath = join(home, ".agents", "skills", "orchestrator", "SKILL.md");
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(
    skillPath,
    "---\nname: orchestrator\ndisable-model-invocation: true\n---\n# Orchestrator\n\nNever implement ticket changes yourself.\n",
  );

  let contextHook: ((event: { sessionID: string; system: Array<{ text: string }> }) => Promise<void>) | undefined;
  const context = {
    session: {
      hook: async (_name: string, callback: typeof contextHook) => {
        contextHook = callback;
        return { dispose: async () => undefined };
      },
    },
  };

  try {
    const cleanup = await (plugin.setup as any)(context);
    assert.ok(contextHook);

    const ordinary = { sessionID: "ordinary", system: [{ text: "base" }] };
    await contextHook(ordinary);
    assert.deepEqual(ordinary.system, [{ text: "base" }]);

    await atomicWriteJson(registrationPath(stateRoot(), "worker"), {
      version: 1,
      sessionID: "worker",
      directory: home,
      workerOrchestrationID: "parent-id",
      updatedAt: Date.now(),
    });
    const worker = { sessionID: "worker", system: [{ text: "base" }] };
    await contextHook(worker);
    assert.deepEqual(worker.system, [{ text: "base" }]);

    await atomicWriteJson(registrationPath(stateRoot(), "parent"), {
      version: 1,
      sessionID: "parent",
      directory: home,
      orchestrationID: "parent-id",
      updatedAt: Date.now(),
    });
    const parent = { sessionID: "parent", system: [{ text: "base" }] };
    await contextHook(parent);
    assert.equal(parent.system.length, 2);
    assert.equal(parent.system[1]?.text, "# Orchestrator\n\nNever implement ticket changes yourself.");

    await writeFile(skillPath, "---\r\nname: orchestrator\r\n---\r\nUpdated role\r\n");
    const updated = { sessionID: "parent", system: [{ text: "base" }] };
    await contextHook(updated);
    assert.equal(updated.system[1]?.text, "Updated role");

    await atomicWriteJson(sessionStatePath(stateRoot(), "resumed"), {
      orchestrationSessionId: "persisted-id",
    });
    const resumed = { sessionID: "resumed", system: [{ text: "base" }] };
    await contextHook(resumed);
    assert.equal(resumed.system[1]?.text, "Updated role");
    await cleanup();
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("a standalone OpenCode parent appends the orchestrator role before session registration", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-orchestrator-"));
  const oldHome = process.env.HOME;
  const oldStateHome = process.env.XDG_STATE_HOME;
  const oldOrchestrationID = process.env.OPENCODE_ORCHESTRATION_SESSION_ID;
  process.env.HOME = home;
  process.env.XDG_STATE_HOME = join(home, "state");
  process.env.OPENCODE_ORCHESTRATION_SESSION_ID = "parent-id";
  const skillPath = join(home, ".agents", "skills", "orchestrator", "SKILL.md");
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, "---\nname: orchestrator\n---\n# Orchestrator\n");

  let contextHook: ((event: { sessionID: string; system: Array<{ text: string }> }) => Promise<void>) | undefined;
  try {
    const cleanup = await (plugin.setup as any)({
      session: {
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return { dispose: async () => undefined };
        },
      },
    });
    assert.ok(contextHook);
    const firstTurn = { sessionID: "new-parent", system: [{ text: "base" }] };
    await contextHook(firstTurn);
    assert.deepEqual(firstTurn.system, [{ text: "base" }, { type: "text", text: "# Orchestrator" }]);
    await cleanup();
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    if (oldOrchestrationID === undefined) delete process.env.OPENCODE_ORCHESTRATION_SESSION_ID;
    else process.env.OPENCODE_ORCHESTRATION_SESSION_ID = oldOrchestrationID;
    await rm(home, { recursive: true, force: true });
  }
});
