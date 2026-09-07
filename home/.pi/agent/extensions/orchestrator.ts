import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function orchestratorExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    // PR Watch restores this variable on session start. Workers receive only
    // PI_PARENT_ORCHESTRATION_SESSION_ID and must keep their ordinary role.
    if (!process.env.PI_ORCHESTRATION_SESSION_ID?.trim()) return;

    const skillPath = join(homedir(), ".agents", "skills", "orchestrator", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    const instructions = skill.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
    return {
      systemPrompt: `${event.systemPrompt}\n\n${instructions}`,
    };
  });
}
