import { randomUUID } from "node:crypto";
import { Plugin } from "@opencode/plugin/tui";

import {
  atomicWriteJson,
  atomicWriteJsonSync,
  commandResponsePath,
  createLaunchRoleClaim,
  readJson,
  readJsonSync,
  registrationPath,
  stateRoot,
  statusPath,
  type CommandResponse,
  type Registration,
  type StatusSnapshot,
} from "../../lib/pr-watch-ipc.ts";

const HEARTBEAT_MS = 5_000;
type Location = { directory: string; workspaceID?: string };

// The CLI runs plugin setup more than once per process (plugin reconciliation
// disposes and re-creates plugins while the TUI starts, before a session
// exists) and reloads this module when its source changes. Claim the launch
// role once per process, keep the claim on globalThis so a module reload cannot
// bind it to a second session, and leave the launch variables in the
// environment so a later setup still sees them.
const LAUNCH_CLAIM = Symbol.for("dotfiles.pr-watch.launchClaim");
const claimLaunchRole: ReturnType<typeof createLaunchRoleClaim> = ((globalThis as any)[LAUNCH_CLAIM] ??=
  createLaunchRoleClaim({
    orchestrationID: process.env.OPENCODE_ORCHESTRATION_SESSION_ID?.trim() || undefined,
    workerOrchestrationID: process.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID?.trim() || undefined,
  }));

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default Plugin.define({
  id: "dotfiles.pr-watch-tui",
  setup: async (ctx) => {
    const root = stateRoot();
    const [view, updateView] = ctx.storage.memory<{ status?: StatusSnapshot }>("pr-watch-view", {
      initial: {},
    });
    let selectedSessionID: string | undefined;
    let disposed = false;
    let registrationQueue = Promise.resolve();
    const movedLocations = new Map<string, Location>();
    const seenNotificationIDs = new Map<string, Set<string>>();

    function registrationFor(sessionID: string, movedLocation?: Location): Registration {
      if (movedLocation) movedLocations.set(sessionID, movedLocation);
      const path = registrationPath(root, sessionID);
      const existing = readJsonSync<Registration>(path);
      const existingLocation = existing
        ? { directory: existing.directory, workspaceID: existing.workspaceID }
        : undefined;
      const location =
        movedLocations.get(sessionID) ?? ctx.data.session.get(sessionID)?.location ?? existingLocation ?? ctx.location;
      const role = claimLaunchRole(sessionID, existing);
      return {
        version: 1,
        sessionID,
        directory: location?.directory ?? process.cwd(),
        workspaceID: location?.workspaceID,
        ...role,
        updatedAt: Date.now(),
      };
    }

    function registerImmediately(sessionID: string, movedLocation?: Location): void {
      selectedSessionID = sessionID;
      atomicWriteJsonSync(registrationPath(root, sessionID), registrationFor(sessionID, movedLocation));
      const status = readJsonSync<StatusSnapshot>(statusPath(root, sessionID));
      seenNotificationIDs.set(sessionID, new Set((status?.notifications ?? []).map((notification) => notification.id)));
      updateView((draft) => {
        draft.status = status;
      });
    }

    function register(sessionID: string, movedLocation?: Location): Promise<StatusSnapshot | undefined> {
      const pending = registrationQueue.then(async () => {
        selectedSessionID = sessionID;
        const path = registrationPath(root, sessionID);
        await atomicWriteJson(path, registrationFor(sessionID, movedLocation));
        const next = await readJson<StatusSnapshot>(statusPath(root, sessionID));
        updateView((draft) => {
          draft.status = next;
        });
        return next;
      });
      registrationQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    }

    async function registerCurrent(): Promise<void> {
      const route = ctx.ui.router.current();
      if (route.type === "session") {
        const status = await register(route.sessionID);
        seenNotificationIDs.set(
          route.sessionID,
          new Set((status?.notifications ?? []).map((notification) => notification.id)),
        );
      }
    }

    async function runCommand(input = ""): Promise<void> {
      const route = ctx.ui.router.current();
      if (route.type !== "session") {
        ctx.ui.toast.show({
          message: "Open a session before you use /pr-watch.",
          variant: "warning",
        });
        return;
      }
      await register(route.sessionID);
      const requestID = randomUUID();
      await ctx.client.session.synthetic({
        sessionID: route.sessionID,
        text: input.trim() || "status",
        description: "PR watch command",
        metadata: { kind: "pr-watch-command", requestID },
        resume: false,
      });
      let response: CommandResponse | undefined;
      while (!response && !disposed) {
        response = await readJson<CommandResponse>(commandResponsePath(root, route.sessionID, requestID));
        if (!response) await sleep(100);
      }
      if (disposed) return;
      ctx.ui.toast.show({
        title: "PR watch",
        message: response!.message,
        variant: response!.variant,
        duration: 10_000,
      });
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
        if (sessionID !== selectedSessionID) registerImmediately(sessionID);
        const value = view.status;
        if (!value?.text || value.sessionID !== sessionID) return null;
        const color = value.warning ? ctx.theme.text.feedback.warning.default : ctx.theme.text.subdued;
        return <text fg={color}> {value.text}</text>;
      },
    });

    const eventDisposals = [
      ctx.data.on("session.created", (event) => {
        const route = ctx.ui.router.current();
        if (route.type === "session" && route.sessionID === event.data.sessionID) registerImmediately(route.sessionID);
      }),
      ctx.data.on("session.moved", (event) => {
        if (event.data.sessionID === selectedSessionID) registerImmediately(event.data.sessionID, event.data.location);
      }),
    ];

    await registerCurrent();
    const timer = setInterval(() => {
      void (async () => {
        if (!selectedSessionID || disposed) return;
        const sessionID = selectedSessionID;
        const previousNotificationIDs = seenNotificationIDs.get(sessionID) ?? new Set<string>();
        const next = await register(selectedSessionID);
        for (const notification of next?.notifications ?? []) {
          if (previousNotificationIDs.has(notification.id)) continue;
          ctx.ui.toast.show({
            title: "PR watch",
            message: notification.message,
            variant: notification.variant,
          });
          previousNotificationIDs.add(notification.id);
        }
        seenNotificationIDs.set(sessionID, previousNotificationIDs);
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
