import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import orchestratorExtension from "../orchestrator.ts";

test("orchestrator system instructions follow the current environment, not conversation history", async () => {
  const home = await mkdtemp(join(tmpdir(), "orchestrator-prompt-"));
  const names = ["HOME", "PI_ORCHESTRATION_SESSION_ID", "PI_PARENT_ORCHESTRATION_SESSION_ID"];
  const saved = names.map((name) => process.env[name]);
  const skillPath = join(home, ".agents/skills/orchestrator/SKILL.md");
  const skill = await readFile(resolve(import.meta.dirname, "../../../../.agents/skills/orchestrator/SKILL.md"), "utf8");
  const handlers = new Map<string, (event: { systemPrompt: string }) => Promise<{ systemPrompt: string } | undefined>>();
  try {
    process.env.HOME = home;
    delete process.env.PI_ORCHESTRATION_SESSION_ID;
    process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = "parent-id";
    orchestratorExtension({
      on(name: string, handler: (event: { systemPrompt: string }) => Promise<{ systemPrompt: string } | undefined>) {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI);
    const beforeStart = handlers.get("before_agent_start");
    assert.ok(beforeStart);

    // A worker does not even need access to the orchestrator skill.
    assert.equal(await beforeStart({ systemPrompt: "Worker prompt" }), undefined);
    delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
    assert.equal(await beforeStart({ systemPrompt: "Ordinary prompt" }), undefined);
    process.env.PI_ORCHESTRATION_SESSION_ID = "  ";
    assert.equal(await beforeStart({ systemPrompt: "Ordinary prompt" }), undefined);

    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, skill);
    // Simulate PR Watch restoring the variable after extension registration.
    process.env.PI_ORCHESTRATION_SESSION_ID = "restored-id";
    const base = "Base instructions plus earlier extension instructions";
    const first = await beforeStart({ systemPrompt: base });
    assert.ok(first);
    assert.ok(first.systemPrompt.startsWith(`${base}\n\n# Orchestrator\n`));
    assert.ok(first.systemPrompt.includes("Never implement ticket changes yourself."));
    assert.ok(first.systemPrompt.endsWith(skill.trim().split("\n").at(-1)!));
    assert.ok(!first.systemPrompt.includes("disable-model-invocation:"));

    // Each new run gets the full role without needing any retained messages.
    assert.deepEqual(await beforeStart({ systemPrompt: base }), first);
    assert.equal(first.systemPrompt.split("# Orchestrator\n").length, 2);

    // The canonical file remains the only source of role instructions.
    await writeFile(skillPath, "---\r\nname: orchestrator\r\n---\r\nUpdated role\r\n");
    assert.deepEqual(await beforeStart({ systemPrompt: base }), {
      systemPrompt: `${base}\n\nUpdated role`,
    });
    delete process.env.PI_ORCHESTRATION_SESSION_ID;
    assert.equal(await beforeStart({ systemPrompt: base }), undefined);
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
    await rm(home, { recursive: true, force: true });
  }
});
