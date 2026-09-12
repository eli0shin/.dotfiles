import { randomUUID } from "node:crypto";
import { Plugin } from "@opencode/plugin/tui";

import {
  atomicWriteJson,
  commandRequestPath,
  commandResponsePath,
  readJson,
  registrationPath,
  stateRoot,
  statusPath,
  type CommandRequest,
  type CommandResponse,
  type Registration,
  type StatusSnapshot,
} from "../../lib/pr-watch-ipc.ts";

const HEARTBEAT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 30_000;
type Location = { directory: string; workspaceID?: string };

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default Plugin.define({
  id: "dotfiles.pr-watch-tui",
  setup: async (ctx) => {
    const root = stateRoot();
    const orchestrationID = process.env.OPENCODE_ORCHESTRATION_SESSION_ID?.trim() || undefined;
    const workerOrchestrationID = process.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID?.trim() || undefined;
    const [view, updateView] = ctx.storage.memory<{ status?: StatusSnapshot }>("pr-watch-view", {
      initial: {},
    });
    let selectedSessionID: string | undefined;
    let disposed = false;
    let registrationQueue = Promise.resolve();
    const movedLocations = new Map<string, Location>();

    function register(sessionID: string, movedLocation?: Location): Promise<StatusSnapshot | undefined> {
      if (movedLocation) movedLocations.set(sessionID, movedLocation);
      const pending = registrationQueue.then(async () => {
        selectedSessionID = sessionID;
        const path = registrationPath(root, sessionID);
        const existing = await readJson<Registration>(path);
        const existingLocation = existing
          ? { directory: existing.directory, workspaceID: existing.workspaceID }
          : undefined;
        const location = movedLocations.get(sessionID) ?? ctx.data.session.get(sessionID)?.location ?? existingLocation ?? ctx.location;
        const registration: Registration = {
          version: 1,
          sessionID,
          directory: location?.directory ?? process.cwd(),
          workspaceID: location?.workspaceID,
          orchestrationID: existing?.orchestrationID ?? orchestrationID,
          workerOrchestrationID: existing?.workerOrchestrationID ?? workerOrchestrationID,
          updatedAt: Date.now(),
        };
        await atomicWriteJson(path, registration);
        const next = await readJson<StatusSnapshot>(statusPath(root, sessionID));
        updateView((draft) => {
          draft.status = next;
        });
        return next;
      });
      registrationQueue = pending.then(() => undefined, () => undefined);
      return pending;
    }

    async function registerCurrent(): Promise<void> {
      const route = ctx.ui.router.current();
      if (route.type === "session") await register(route.sessionID);
    }

    async function runCommand(input = ""): Promise<void> {
      const route = ctx.ui.router.current();
      if (route.type !== "session") {
        ctx.ui.toast.show({ message: "Open a session before you use /pr-watch.", variant: "warning" });
        return;
      }
      await register(route.sessionID);
      const requestID = randomUUID();
      const request: CommandRequest = {
        version: 1,
        id: requestID,
        sessionID: route.sessionID,
        input: input.trim() || "status",
        createdAt: Date.now(),
      };
      await atomicWriteJson(commandRequestPath(root, route.sessionID, requestID), request);
      const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
      let response: CommandResponse | undefined;
      while (!response && Date.now() < deadline) {
        response = await readJson<CommandResponse>(commandResponsePath(root, route.sessionID, requestID));
        if (!response) await sleep(100);
      }
      ctx.ui.toast.show(
        response
          ? { title: "PR watch", message: response.message, variant: response.variant, duration: 10_000 }
          : { title: "PR watch", message: "The command timed out.", variant: "error" },
      );
      const next = await readJson<StatusSnapshot>(statusPath(root, route.sessionID));
      updateView((draft) => {
        draft.status = next;
      });
    }

    const removeSlot = ctx.ui.slot({
      append: "prompt.footer",
      render: ({ sessionID }) => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "pr-watch.command",
              title: "PR watch",
              description: "Watch PRs for CI completion and relevant feedback",
              slash: { name: "pr-watch", arguments: true },
              palette: true,
              run: runCommand,
            },
          ],
        }));
        if (!sessionID) return null;
        if (sessionID !== selectedSessionID) void register(sessionID);
        const value = view.status;
        if (!value?.text || value.sessionID !== sessionID) return null;
        const color = value.warning ? ctx.theme.text.feedback.warning.default : ctx.theme.text.subdued;
        return <text fg={color}> {value.text}</text>;
      },
    });

    const eventDisposals = [
      ctx.data.on("session.created", (event) => {
        const route = ctx.ui.router.current();
        if (route.type === "session" && route.sessionID === event.data.sessionID) void register(route.sessionID);
      }),
      ctx.data.on("session.moved", (event) => {
        if (event.data.sessionID === selectedSessionID) void register(event.data.sessionID, event.data.location);
      }),
    ];

    await registerCurrent();
    const timer = setInterval(() => {
      void (async () => {
        if (!selectedSessionID || disposed) return;
        const previousPending = view.status?.pending ?? 0;
        const next = await register(selectedSessionID);
        if (next && next.pending > previousPending) {
          ctx.ui.toast.show({
            title: "PR watch",
            message: `Buffered ${next.pending} update${next.pending === 1 ? "" : "s"}.`,
            variant: "info",
          });
        }
      })();
    }, HEARTBEAT_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
      removeSlot();
      for (const dispose of eventDisposals) dispose();
    };
  },
});
