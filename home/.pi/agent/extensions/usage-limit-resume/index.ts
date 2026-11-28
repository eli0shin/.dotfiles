import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  CONTINUATION_TYPE, MAX_OVERDUE_MS, STATE_TYPE, lastConversationEntry, pendingQuotaWait,
  planQuotaWait, quotaFailure, type QuotaWait,
} from "./state.ts";

const RETRY_BUSY_MS = 1_000;
const MAX_JITTER_MS = 15_000;

function configuredProviders(ctx: ExtensionContext): string[] {
  try {
    const { providers } = JSON.parse(readFileSync(join(getAgentDir(), "usage-limit-resume.json"), "utf8"));
    if (!Array.isArray(providers) || !providers.every((provider) => typeof provider === "string")) {
      throw new Error("expected a providers array");
    }
    return providers;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return ["claude-bridge"];
    ctx.ui.notify(`Usage limit auto-resume disabled: ${error instanceof Error ? error.message : error}`, "warning");
    return [];
  }
}

export default function usageLimitResume(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armed: QuotaWait | undefined;
  let dispatching: QuotaWait | undefined;
  let continuation: QuotaWait | undefined;
  let providers: string[] = [];
  let waitingForUser = false;
  const enabled = (ctx: ExtensionContext) => ctx.mode === "tui" && providers.includes(ctx.model?.provider ?? "");

  function clearTimer(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  function disarm(ctx: ExtensionContext, persist: boolean): void {
    if (!armed && (!persist || !pendingQuotaWait(ctx))) return;
    if (persist) pi.appendEntry(STATE_TYPE, null);
    armed = undefined;
    clearTimer();
    ctx.ui.setStatus(STATE_TYPE, undefined);
  }

  function schedule(ctx: ExtensionContext, wait: QuotaWait): void {
    clearTimer();
    armed = wait;
    ctx.ui.setStatus(STATE_TYPE, `Usage limited · resumes ${new Date(wait.dueAt).toLocaleString()}`);

    const wake = () => {
      if (armed !== wait) return;
      const now = Date.now();
      if (!enabled(ctx) || pendingQuotaWait(ctx)?.failureId !== wait.failureId || now - wait.dueAt > MAX_OVERDUE_MS) {
        disarm(ctx, true);
        return;
      }
      // Recompute against the wall clock after wake/sleep or a clock adjustment.
      if (now < wait.dueAt || !ctx.isIdle() || waitingForUser) {
        timer = setTimeout(wake, Math.max(RETRY_BUSY_MS, wait.dueAt - now));
        return;
      }
      // Consume the reservation before dispatch. On ambiguous crash/dispatch failure,
      // don't replay it and risk launching the same continuation twice.
      disarm(ctx, true);
      dispatching = wait;
      try {
        pi.sendMessage({ customType: CONTINUATION_TYPE, content: "Continue.", display: true, details: wait }, { triggerTurn: true });
      } catch (error) {
        dispatching = undefined;
        ctx.ui.notify(`Usage-limit resume did not start: ${error instanceof Error ? error.message : error}`, "warning");
      }
    };
    timer = setTimeout(wake, Math.max(0, wait.dueAt - Date.now()));
  }

  pi.registerMessageRenderer(CONTINUATION_TYPE, (_message, _options, theme) =>
    new Text(theme.fg("customMessageLabel", "▸ Pi usage limit resumed") + " · Continue.", 0, 0));

  pi.registerCommand("cancel-usage-limit-resume", {
    description: "Cancel this session's scheduled usage-limit resume",
    handler: async (_args, ctx) => {
      if (!armed && !pendingQuotaWait(ctx)) {
        ctx.ui.notify("No usage-limit resume scheduled.", "info");
        return;
      }
      disarm(ctx, true);
      ctx.ui.notify("Usage-limit resume canceled.", "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    providers = configuredProviders(ctx);
    const wait = pendingQuotaWait(ctx);
    if (wait && enabled(ctx) && Date.now() - wait.dueAt <= MAX_OVERDUE_MS) schedule(ctx, wait);
    else if (wait) disarm(ctx, true);
  });
  pi.on("session_shutdown", (event, ctx) => disarm(ctx, event.reason !== "reload"));
  pi.on("session_before_tree", (_event, ctx) => disarm(ctx, true));
  pi.on("model_select", (_event, ctx) => disarm(ctx, true));
  pi.on("ui_prompt_start", () => { waitingForUser = true; });
  pi.on("ui_prompt_end", () => { waitingForUser = false; });
  pi.on("before_agent_start", (event, ctx) => {
    if (event.messageType === "custom" && event.message.customType === CONTINUATION_TYPE) {
      continuation = dispatching;
    } else {
      continuation = undefined;
      disarm(ctx, true);
    }
    dispatching = undefined;
  });

  pi.on("agent_before_settle", (event, ctx) => {
    if (event.outcome !== "error" || !enabled(ctx)) return;
    const failure = lastConversationEntry(ctx.sessionManager.getBranch());
    const limit = quotaFailure(ctx, failure);
    if (!failure || !limit) return;
    const wait = planQuotaWait(failure.id, limit, continuation, Date.now(), Math.floor(Math.random() * MAX_JITTER_MS));
    if (!wait) return;
    // Persist at the final actionable boundary so PR Watch can distinguish a
    // quota wait from a terminal worker stop, regardless of settled hook order.
    return { entries: [...event.entries, { type: "custom", customType: STATE_TYPE, data: wait }] };
  });
  pi.on("agent_settled", (event, ctx) => {
    continuation = undefined;
    if (event.aborted) {
      disarm(ctx, true);
      return;
    }
    const wait = pendingQuotaWait(ctx);
    if (wait && enabled(ctx)) schedule(ctx, wait);
  });
}
