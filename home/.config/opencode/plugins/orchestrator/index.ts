import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Plugin } from "@opencode/plugin";

import { readJson, registrationPath, sessionStatePath, stateRoot, type Registration } from "../../lib/pr-watch-ipc.ts";

type PersistedRole = { orchestrationSessionId?: string };

export function skillInstructions(skill: string): string {
  return skill.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
}

export default Plugin.define({
  id: "dotfiles.orchestrator",
  setup: async (ctx) => {
    const root = stateRoot();
    const requestedOrchestrationID = process.env.OPENCODE_ORCHESTRATION_SESSION_ID?.trim() || undefined;
    const skillPath = join(homedir(), ".agents", "skills", "orchestrator", "SKILL.md");
    const registration = await ctx.session.hook("context", async (event) => {
      const saved = await readJson<PersistedRole>(sessionStatePath(root, event.sessionID));
      const current = await readJson<Registration>(registrationPath(root, event.sessionID));
      if (!requestedOrchestrationID && !saved?.orchestrationSessionId && !current?.orchestrationID) return;

      const instructions = skillInstructions(await readFile(skillPath, "utf8"));
      event.system.push({ type: "text", text: instructions });
    });
    return registration.dispose;
  },
});
