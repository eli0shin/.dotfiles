import { readdir } from "node:fs/promises";

import { Plugin } from "@opencode/plugin";

import { createPrWatchController } from "../../lib/pr-watch-core.ts";
import {
  commandResponsePath,
  createLaunchRoleClaim,
  isFreshRegistration,
  readJson,
  registrationPath,
  stateRoot,
  type CommandResponse,
  type Registration,
} from "../../lib/pr-watch-ipc.ts";

const COMMAND_POLL_MS = 500;
const HARNESS_GUIDANCE =
  "PR Watch monitors CI and PR feedback after supported PR commands and pushes. Return control after these operations; PR Watch will trigger a new turn when action is needed. Treat <pr-watch-harness-notification> blocks as harness notifications, not user messages.";

type Controller = Awaited<ReturnType<typeof createPrWatchController>>;
type ShellCall = { command: string; output?: string };
type Location = { directory: string; workspaceID?: string };

function sameLocation(left: Location, right: Location): boolean {
  return left.directory === right.directory && left.workspaceID === right.workspaceID;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function withOrchestrationEnvironment(command: string, orchestrationID: string): string {
  return `export OPENCODE_ORCHESTRATION_SESSION_ID=${shellQuote(orchestrationID)}; ${command}`;
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

export const LAUNCH_CLAIM = Symbol.for("dotfiles.pr-watch.serverLaunchClaim");

export default Plugin.define({
  id: "dotfiles.pr-watch",
  setup: async (ctx) => {
    const root = stateRoot();
    // Setup can run more than once per process and the module can reload, so
    // claim the launch role once per process and leave the launch variable in
    // place. The shell hook below keeps it out of tool shells.
    const claimLaunchWorkerRole: ReturnType<typeof createLaunchRoleClaim> = ((globalThis as any)[LAUNCH_CLAIM] ??=
      createLaunchRoleClaim({
        workerOrchestrationID: process.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID?.trim() || undefined,
      }));
    const controllers = new Map<string, Promise<Controller>>();
    const locations = new Map<string, string>();
    const shellCalls = new Map<string, ShellCall>();
    const commandRequests = new Map<string, string>();
    const idle = new Map<string, boolean>();
    const assistantAtExecutionStart = new Map<string, string | undefined>();
    const disposals: Array<() => Promise<void> | void> = [];

    async function controller(sessionID: string, directory?: string): Promise<Controller> {
      const existing = controllers.get(sessionID);
      if (existing) return existing;
      const pending = (async () => {
        const registered = await readJson<Registration>(registrationPath(root, sessionID));
        const role = claimLaunchWorkerRole(sessionID, registered);
        const next = await createPrWatchController({
          sessionID,
          directory: directory ?? registered?.directory ?? locations.get(sessionID) ?? ctx.location.directory,
          root,
          orchestrationID: registered?.orchestrationID,
          workerOrchestrationID: role.workerOrchestrationID,
          isIdle: () => idle.get(sessionID) !== false,
          hasDelivery: async (id) => {
            const marker = `<!-- pr-watch-delivery:${id} -->`;
            const messages = await ctx.session.context({ sessionID });
            return messages.some((message) => message.type === "synthetic" && message.text.includes(marker));
          },
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
        await next.initialize();
        return next;
      })();
      controllers.set(sessionID, pending);
      try {
        return await pending;
      } catch (error) {
        if (controllers.get(sessionID) === pending) controllers.delete(sessionID);
        throw error;
      }
    }

    async function disposeController(sessionID: string): Promise<void> {
      const pending = controllers.get(sessionID);
      controllers.delete(sessionID);
      (await pending)?.dispose();
    }

    function registrationLocation(registration: Registration): Location {
      return {
        directory: registration.directory,
        workspaceID: registration.workspaceID,
      };
    }

    function parseLocation(value: unknown): Location | undefined {
      if (typeof value !== "object" || !value || !("directory" in value)) return undefined;
      const location = value as { directory: unknown; workspaceID?: unknown };
      if (typeof location.directory !== "string") return undefined;
      return {
        directory: location.directory,
        workspaceID: typeof location.workspaceID === "string" ? location.workspaceID : undefined,
      };
    }

    disposals.push(
      (
        await ctx.shell.hook("create.before", (input) => {
          delete input.env.OPENCODE_ORCHESTRATION_SESSION_ID;
          delete input.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID;
          delete input.env.PI_ORCHESTRATION_SESSION_ID;
          delete input.env.PI_PARENT_ORCHESTRATION_SESSION_ID;
        })
      ).dispose,
    );

    disposals.push(
      (
        await ctx.session.hook("context", async (event) => {
          if ((await controller(event.sessionID)).getState().mode !== "off")
            event.system.push({ type: "text", text: HARNESS_GUIDANCE });
        })
      ).dispose,
    );

    disposals.push(
      (
        await ctx.tool.hook("execute.before", async (input) => {
          if (input.tool !== "shell" && input.tool !== "bash") return;
          const value = input.input as { command?: unknown };
          if (typeof value.command !== "string") return;
          shellCalls.set(input.id, { command: value.command });
          const registration = await readJson<Registration>(registrationPath(root, input.sessionID));
          const orchestrationID = registration?.orchestrationID;
          if (orchestrationID) {
            value.command = withOrchestrationEnvironment(value.command, orchestrationID);
          }
        })
      ).dispose,
    );

    disposals.push(
      (
        await ctx.tool.hook("execute.after", async (input) => {
          const call = shellCalls.get(input.id);
          shellCalls.delete(input.id);
          if (!call) return;
          const output = input.status === "completed" ? textContent(input.result.content) : "";
          await (await controller(input.sessionID)).observeShell(call.command, output, input.status === "completed");
        })
      ).dispose,
    );

    const eventAbort = new AbortController();
    const eventStream = await ctx.event.subscribe({ signal: eventAbort.signal });
    let eventLoopStopped = false;
    const eventLoop = (async () => {
      for await (const event of eventStream) {
        if (eventLoopStopped) break;
        try {
          const data = event.data as Record<string, unknown>;
          const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;
          if (!sessionID) continue;
          if (event.type === "session.moved") {
            const destination = parseLocation(data.location);
            if (!destination || !sameLocation(destination, ctx.location)) {
              await disposeController(sessionID);
              continue;
            }
            locations.set(sessionID, destination.directory);
            await disposeController(sessionID);
            await controller(sessionID, destination.directory);
            continue;
          }
          const sourceLocation = parseLocation(event.location);
          if (!sourceLocation || !sameLocation(sourceLocation, ctx.location)) continue;
          const directory = sourceLocation.directory;
          if (directory) locations.set(sessionID, directory);
          if (event.type === "session.created") await controller(sessionID, directory);
          if (event.type === "session.execution.started") {
            idle.set(sessionID, false);
            const messages = await ctx.session.context({ sessionID });
            const assistant = [...messages].reverse().find((message) => message.type === "assistant");
            assistantAtExecutionStart.set(sessionID, assistant?.id);
          }
          if (
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" ||
            event.type === "session.idle"
          ) {
            idle.set(sessionID, true);
            const current = await controller(sessionID, directory);
            const registered = await readJson<Registration>(registrationPath(root, sessionID));
            if (current.getState().workerOrchestrationSessionId && event.type !== "session.idle") {
              if (registered?.workerOrchestrationID) await current.adoptRegistration(registered);
              const messages = await ctx.session.context({ sessionID });
              const assistant = [...messages].reverse().find((message) => message.type === "assistant");
              if (assistant?.type === "assistant" && assistant.id !== assistantAtExecutionStart.get(sessionID)) {
                const response =
                  assistant.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n")
                    .trim() ||
                  assistant.error?.message ||
                  `Assistant stopped with reason: ${assistant.finish ?? "unknown"}.`;
                await current.settle(assistant.id, response);
              } else if (event.type === "session.execution.failed") {
                await current.settle(
                  event.id,
                  String((data.error as { message?: unknown } | undefined)?.message ?? "Assistant execution failed."),
                );
              } else if (event.type === "session.execution.interrupted") {
                await current.settle(event.id, "Assistant execution was interrupted.");
              }
              assistantAtExecutionStart.delete(sessionID);
            }
            await current.flushPending();
          }
          if (event.type === "session.synthetic") {
            const synthetic = data as {
              sessionID: string;
              text: string;
              metadata?: Record<string, unknown>;
            };
            if (synthetic.metadata?.kind !== "pr-watch-command" || typeof synthetic.metadata.requestID !== "string")
              continue;
            commandRequests.set(synthetic.metadata.requestID, sessionID);
            await (await controller(sessionID, directory)).command(synthetic.text, synthetic.metadata.requestID);
          }
        } catch (error) {
          console.error("PR Watch could not process an OpenCode event:", error);
        }
      }
    })();

    let scanInFlight = false;
    const registrationTimer = setInterval(() => {
      if (scanInFlight) return;
      scanInFlight = true;
      void (async () => {
        const entries = await readdir(`${root}/registrations`, {
          withFileTypes: true,
        }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          const registered = await readJson<Registration>(`${root}/registrations/${entry.name}`);
          if (!registered) continue;
          if (!sameLocation(registrationLocation(registered), ctx.location) || !isFreshRegistration(registered)) {
            await disposeController(registered.sessionID);
            continue;
          }
          if (!controllers.has(registered.sessionID)) continue;
          const current = await controller(registered.sessionID, registered.directory);
          await current.adoptRegistration(registered);
        }
        for (const [requestID, sessionID] of commandRequests) {
          const response = await readJson<CommandResponse>(commandResponsePath(root, sessionID, requestID));
          if (response) commandRequests.delete(requestID);
        }
      })()
        .catch((error) => console.error("PR Watch could not scan OpenCode registrations:", error))
        .finally(() => {
          scanInFlight = false;
        });
    }, COMMAND_POLL_MS);

    return async () => {
      eventLoopStopped = true;
      eventAbort.abort();
      clearInterval(registrationTimer);
      await Promise.allSettled([eventLoop]);
      const activeControllers = await Promise.allSettled(controllers.values());
      for (const value of activeControllers) {
        if (value.status === "fulfilled") value.value.dispose();
      }
      await Promise.all(disposals.map((dispose) => dispose()));
    };
  },
});
