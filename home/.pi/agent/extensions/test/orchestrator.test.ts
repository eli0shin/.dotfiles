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
  type BeforeStartEvent = { systemPromptOptions: { sections: Record<string, string> } };
  const handlers = new Map<string, (event: BeforeStartEvent) => Promise<unknown>>();
  try {
    process.env.HOME = home;
    delete process.env.PI_ORCHESTRATION_SESSION_ID;
    process.env.PI_PARENT_ORCHESTRATION_SESSION_ID = "parent-id";
    orchestratorExtension({
      on(name: string, handler: (event: BeforeStartEvent) => Promise<unknown>) {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI);
    const beforeStart = handlers.get("before_agent_start");
    assert.ok(beforeStart);
    // Pi builds each run's sections from the base options, so every run starts without the role.
    const runSections = async () => {
      const event: BeforeStartEvent = { systemPromptOptions: { sections: { earlier: "Earlier extension section" } } };
      assert.equal(await beforeStart(event), undefined);
      return event.systemPromptOptions.sections;
    };

    // A worker does not even need access to the orchestrator skill.
    assert.deepEqual(await runSections(), { earlier: "Earlier extension section" });
    delete process.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
    assert.deepEqual(await runSections(), { earlier: "Earlier extension section" });
    process.env.PI_ORCHESTRATION_SESSION_ID = "  ";
    assert.deepEqual(await runSections(), { earlier: "Earlier extension section" });

    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, skill);
    // Simulate PR Watch restoring the variable after extension registration.
    process.env.PI_ORCHESTRATION_SESSION_ID = "restored-id";
    const first = await runSections();
    assert.equal(first.earlier, "Earlier extension section");
    const role = first.orchestrator;
    assert.ok(role);
    assert.ok(role.startsWith("# Orchestrator\n"));
    assert.ok(role.includes("Never implement ticket changes yourself."));
    assert.ok(role.endsWith(skill.trim().split("\n").at(-1)!));
    assert.ok(!role.includes("disable-model-invocation:"));

    // Each new run gets the full role without needing any retained messages.
    assert.deepEqual(await runSections(), first);
    assert.equal(role.split("# Orchestrator\n").length, 2);

    // The canonical file remains the only source of role instructions.
    await writeFile(skillPath, "---\r\nname: orchestrator\r\n---\r\nUpdated role\r\n");
    assert.deepEqual(await runSections(), { earlier: "Earlier extension section", orchestrator: "Updated role" });
    delete process.env.PI_ORCHESTRATION_SESSION_ID;
    assert.deepEqual(await runSections(), { earlier: "Earlier extension section" });
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
    await rm(home, { recursive: true, force: true });
  }
});
