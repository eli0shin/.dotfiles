import { readdir, rm } from "node:fs/promises";

import { Plugin } from "@opencode-ai/plugin";

import { createPrWatchController } from "../lib/pr-watch-core.ts";
import {
  commandDirectory,
  commandResponsePath,
  isFreshRegistration,
  readJson,
  registrationPath,
  stateRoot,
  type CommandRequest,
  type CommandResponse,
  type Registration,
} from "../lib/pr-watch-ipc.ts";

const COMMAND_POLL_MS = 500;

type Controller = Awaited<ReturnType<typeof createPrWatchController>>;
type ShellCall = { command: string; output?: string };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item
        ? String(item.text)
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

export default Plugin.define({
  id: "dotfiles.pr-watch",
  setup: async (ctx) => {
    const root = stateRoot();
    const controllers = new Map<string, Controller>();
    const locations = new Map<string, string>();
    const shellCalls = new Map<string, ShellCall>();
    const commandRequests = new Map<string, string>();
    const disposals: Array<() => Promise<void> | void> = [];

    async function controller(sessionID: string, directory?: string): Promise<Controller> {
      const existing = controllers.get(sessionID);
      if (existing) return existing;
      const registered = await readJson<Registration>(registrationPath(root, sessionID));
      const next = await createPrWatchController({
        sessionID,
        directory: directory ?? registered?.directory ?? locations.get(sessionID) ?? process.cwd(),
        root,
        wake: async (message) => {
          await ctx.session.synthetic({
            sessionID,
            text: message,
            description: "PR watch update",
            delivery: "queue",
            resume: true,
          });
        },
      });
      controllers.set(sessionID, next);
      await next.initialize();
      return next;
    }

    disposals.push(
      (await ctx.tool.hook("execute.before", async (input) => {
        if (input.tool !== "shell" && input.tool !== "bash") return;
        const value = input.input as { command?: unknown };
        if (typeof value.command !== "string") return;
        shellCalls.set(input.id, { command: value.command });
        const registration = await readJson<Registration>(registrationPath(root, input.sessionID));
        if (registration?.orchestrationID) {
          value.command = `export PI_ORCHESTRATION_SESSION_ID=${shellQuote(registration.orchestrationID)}; ${value.command}`;
        }
      })).dispose,
    );

    disposals.push(
      (await ctx.tool.hook("execute.after", async (input) => {
        const call = shellCalls.get(input.id);
        shellCalls.delete(input.id);
        if (!call) return;
        const output = input.status === "completed" ? textContent(input.result.content) : "";
        await (await controller(input.sessionID)).observeShell(call.command, output, input.status === "completed");
      })).dispose,
    );

    const eventAbort = new AbortController();
    const eventStream = await ctx.event.subscribe({ signal: eventAbort.signal });
    let eventLoopStopped = false;
    const eventLoop = (async () => {
      for await (const event of eventStream) {
        if (eventLoopStopped) break;
        const data = event.data as Record<string, unknown>;
        const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;
        if (!sessionID) continue;
        const directory =
          typeof event.location === "object" && event.location && "directory" in event.location
            ? String(event.location.directory)
            : undefined;
        if (directory) locations.set(sessionID, directory);
        if (event.type === "session.moved" && controllers.has(sessionID)) {
          controllers.get(sessionID)?.dispose();
          controllers.delete(sessionID);
        }
        if (event.type === "session.created" || event.type === "session.moved") await controller(sessionID, directory);
        if (event.type === "session.synthetic") {
          const synthetic = data as { sessionID: string; text: string; metadata?: Record<string, unknown> };
          if (synthetic.metadata?.kind !== "pr-watch-command" || typeof synthetic.metadata.requestID !== "string") continue;
          commandRequests.set(synthetic.metadata.requestID, sessionID);
          await (await controller(sessionID, directory)).command(synthetic.text, synthetic.metadata.requestID);
        }
      }
    })();

    let scanInFlight = false;
    const registrationTimer = setInterval(() => {
      if (scanInFlight) return;
      scanInFlight = true;
      void (async () => {
        const entries = await readdir(`${root}/registrations`, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          const registered = await readJson<Registration>(`${root}/registrations/${entry.name}`);
          if (!registered) continue;
          if (!isFreshRegistration(registered)) {
            const stale = controllers.get(registered.sessionID);
            stale?.dispose();
            controllers.delete(registered.sessionID);
            continue;
          }
          const current = await controller(registered.sessionID, registered.directory);
          await current.adoptRegistration(registered);
        }
        for (const registered of entries) {
          if (!registered.isFile() || !registered.name.endsWith(".json")) continue;
          const sessionID = decodeURIComponent(registered.name.slice(0, -5));
          const requests = await readdir(commandDirectory(root, sessionID), { withFileTypes: true }).catch(() => []);
          for (const entry of requests) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
            const path = `${commandDirectory(root, sessionID)}/${entry.name}`;
            const request = await readJson<CommandRequest>(path);
            if (!request) continue;
            const current = await controller(sessionID);
            await current.command(request.input, request.id);
            await rm(path, { force: true });
          }
        }
        for (const [requestID, sessionID] of commandRequests) {
          const response = await readJson<CommandResponse>(commandResponsePath(root, sessionID, requestID));
          if (response) commandRequests.delete(requestID);
        }
      })().finally(() => {
        scanInFlight = false;
      });
    }, COMMAND_POLL_MS);

    return async () => {
      eventLoopStopped = true;
      eventAbort.abort();
      clearInterval(registrationTimer);
      await Promise.allSettled([eventLoop]);
      for (const value of controllers.values()) value.dispose();
      await Promise.all(disposals.map((dispose) => dispose()));
    };
  },
});
