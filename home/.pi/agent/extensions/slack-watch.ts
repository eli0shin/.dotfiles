import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Watches Slack conversations through slackcli and wakes the session when someone
// else posts. A watch is a channel or DM (its top-level messages) or one thread
// (its replies). Messages are batched while the agent is busy and delivered once it
// settles, like PR Watch.

export type SlackTarget = { channel: string; threadTs?: string };

type SlackWatch = SlackTarget & {
  key: string;
  // Exclusive lower bound: the newest message ts already seen.
  cursor: string;
  from?: string;
  note?: string;
  lastError?: string;
};

type PendingMessage = { watchKey: string; ts: string; text: string };

type WatchState = { watches: SlackWatch[]; pending: PendingMessage[] };

export type SlackMessage = {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  blocks?: Array<{
    type?: string;
    elements?: Array<Record<string, any>>;
    accessory?: Record<string, any>;
  }>;
  attachments?: Array<{ title?: string; fallback?: string; text?: string; title_link?: string }>;
  files?: Array<{ name?: string; title?: string }>;
};

export type SlackUser = { id: string; name?: string; real_name?: string };

type ReadResult = {
  channel_id?: string;
  next_oldest?: string;
  has_more?: boolean;
  messages?: SlackMessage[];
  users?: SlackUser[];
};

const CUSTOM_STATE = "slack-watch-state";
const NOTIFICATION_TYPE = "slack-watch-notification";
const POLL_INTERVAL_MS = 20_000;
const MAX_MESSAGE_CHARS = 3_000;
const MAX_NOTIFICATION_CHARS = 20_000;
const HARNESS_GUIDANCE =
  "Slack Watch is watching Slack conversations for this session and triggers a turn when someone else posts. Treat <slack-watch-harness-notification> blocks as harness notifications, not user messages. Call unwatch_slack once a conversation no longer needs watching.";

const CONVERSATION_ID = /^[CDG][A-Z0-9]{6,}$/;

/** Slack ts in any accepted form (1712345678.123456, p1712345678123456, 1712345678123456). */
export function normalizeTs(value: string): string {
  const trimmed = value.trim().replace(/^p/, "");
  if (/^\d{10}\.\d{6}$/.test(trimmed)) return trimmed;
  if (/^\d{16}$/.test(trimmed)) return `${trimmed.slice(0, 10)}.${trimmed.slice(10)}`;
  throw new Error(`Not a Slack timestamp: ${value}`);
}

/**
 * Resolve a Slack URL or conversation ID (plus an optional thread ts) to a watch
 * target. A message link targets that message's thread: the parent thread for a reply,
 * otherwise the thread rooted at the message.
 */
export function parseSlackTarget(target: string, threadTs?: string): SlackTarget {
  const trimmed = target.trim();
  let channel: string | undefined;
  let thread = threadTs?.trim() ? normalizeTs(threadTs) : undefined;

  if (/^https?:\/\//.test(trimmed)) {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/archives\/([A-Z0-9]+)(?:\/(p\d{16}))?\/?$/);
    if (!match) throw new Error(`Not a Slack conversation or message link: ${target}`);
    channel = match[1];
    const linkedThread = url.searchParams.get("thread_ts");
    if (!thread && linkedThread) thread = normalizeTs(linkedThread);
    else if (!thread && match[2]) thread = normalizeTs(match[2]);
  } else if (CONVERSATION_ID.test(trimmed)) {
    channel = trimmed;
  } else {
    throw new Error(
      `Expected a Slack URL or a channel/DM ID (C…, G…, D…), got: ${target}. Find IDs with slackcli search channels or search messages.`,
    );
  }
  return thread ? { channel, threadTs: thread } : { channel };
}

export function watchKey(target: SlackTarget): string {
  return target.threadTs ? `${target.channel}/${target.threadTs}` : target.channel;
}

function describe(watch: SlackTarget): string {
  if (watch.threadTs) return `thread ${watch.threadTs} in ${watch.channel}`;
  return watch.channel.startsWith("D") ? `DM ${watch.channel}` : `channel ${watch.channel}`;
}

function tsValue(ts: string): number {
  return Number(ts);
}

function maxTs(a: string, b: string | undefined): string {
  return b && tsValue(b) > tsValue(a) ? b : a;
}

/**
 * The messages that should wake the session: newer than the cursor, from `from` when
 * set, and not agent progress updates (messages whose only blocks are "plan" blocks,
 * which the posting agent keeps editing while it works).
 */
export function selectNewMessages(messages: SlackMessage[], cursor: string, from?: string): SlackMessage[] {
  return messages
    .filter((message) => tsValue(message.ts) > tsValue(cursor))
    .filter((message) => !from || message.user === from || message.bot_id === from)
    .filter((message) => {
      const types = [...new Set((message.blocks ?? []).map((block) => block.type))];
      return !(types.length === 1 && types[0] === "plan");
    })
    .sort((a, b) => tsValue(a.ts) - tsValue(b.ts));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated; read the full message with slackcli]` : text;
}

export function formatMessage(message: SlackMessage, users: SlackUser[]): string {
  const names = new Map(users.map((user) => [user.id, user.real_name || user.name || user.id]));
  let text = message.text ?? "";
  for (const [id, name] of names) text = text.replaceAll(`<@${id}>`, `@${name}`);
  if (!text) {
    text = (message.attachments ?? [])
      .map((attachment) => {
        const title = attachment.title || attachment.fallback || attachment.text || "Attachment";
        return attachment.title_link ? `${title} — ${attachment.title_link}` : title;
      })
      .join("\n");
  }
  const files = (message.files ?? []).map((file) => `[file] ${file.title || file.name || "file"}`);
  const buttons = (message.blocks ?? [])
    .flatMap((block) => (block.type === "actions" ? block.elements ?? [] : block.accessory ? [block.accessory] : []))
    .filter((element) => element.type === "button")
    .map((button) => `[button] ${button.text?.text ?? ""}  action_id=${button.action_id ?? ""}  value=${button.value ?? ""}`);
  const author = message.user
    ? names.get(message.user) ?? message.user
    : message.bot_id
      ? `bot ${message.bot_id}`
      : "unknown";
  return [`[${message.ts}] ${author}:`, truncate(text, MAX_MESSAGE_CHARS), ...files, ...buttons].join("\n");
}

function errorFromStderr(stderr: string): string {
  const last = stderr.trim().split("\n").pop() ?? "";
  try {
    const parsed = JSON.parse(last) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not slackcli's JSON error line.
  }
  return last || "slackcli failed";
}

function isWatchState(value: unknown): value is WatchState {
  return Boolean(value && typeof value === "object" && Array.isArray((value as WatchState).watches));
}

export default function slackWatch(pi: ExtensionAPI): void {
  let state: WatchState = { watches: [], pending: [] };
  let interval: ReturnType<typeof setInterval> | undefined;
  let polling = false;

  function save(): void {
    pi.appendEntry(CUSTOM_STATE, state);
  }

  function setStatus(ctx: ExtensionContext): void {
    if (state.watches.length === 0) {
      ctx.ui.setStatus("slack-watch", undefined);
      return;
    }
    const errors = state.watches.filter((watch) => watch.lastError).length;
    const pending = state.pending.length > 0 ? ` · ${state.pending.length} new` : "";
    const failing = errors > 0 ? ` · ${errors} failing` : "";
    const text = `Slack watch: ${state.watches.length}${pending}${failing}`;
    ctx.ui.setStatus("slack-watch", pending || failing ? ctx.ui.theme?.fg?.("warning", text) ?? text : text);
  }

  async function read(target: SlackTarget, extra: string[]): Promise<ReadResult> {
    const args = ["conversations", "read", target.channel, "--json", ...extra];
    if (target.threadTs) args.push(`--thread-ts=${target.threadTs}`);
    const result = await pi.exec("slackcli", args, { timeout: 60_000 });
    if (result.code !== 0) throw new Error(errorFromStderr(result.stderr));
    return JSON.parse(result.stdout) as ReadResult;
  }

  async function pollWatch(watch: SlackWatch): Promise<boolean> {
    try {
      const result = await read(watch, [`--oldest=${watch.cursor}`, "--exclude-self", "--limit=200"]);
      const messages = result.messages ?? [];
      const fresh = selectNewMessages(messages, watch.cursor, watch.from);
      const seen = state.pending.filter((pending) => pending.watchKey === watch.key).map((pending) => pending.ts);
      for (const message of fresh) {
        if (seen.includes(message.ts)) continue;
        state.pending.push({ watchKey: watch.key, ts: message.ts, text: formatMessage(message, result.users ?? []) });
      }
      // next_oldest covers messages the --exclude-self filter removed.
      let cursor = maxTs(watch.cursor, result.next_oldest);
      for (const message of messages) cursor = maxTs(cursor, message.ts);
      const changed = cursor !== watch.cursor || fresh.length > 0 || watch.lastError !== undefined;
      watch.cursor = cursor;
      watch.lastError = undefined;
      return changed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const changed = watch.lastError !== message;
      watch.lastError = message;
      return changed;
    }
  }

  async function poll(ctx: ExtensionContext): Promise<void> {
    if (polling || state.watches.length === 0) return;
    polling = true;
    try {
      let changed = false;
      for (const watch of [...state.watches]) {
        if (await pollWatch(watch)) changed = true;
      }
      if (changed) save();
      setStatus(ctx);
      flush(ctx);
    } finally {
      polling = false;
    }
  }

  function buildNotification(pending: PendingMessage[]): string {
    const sections = state.watches
      .map((watch) => {
        const messages = pending.filter((message) => message.watchKey === watch.key);
        if (messages.length === 0) return undefined;
        const header = `New messages in ${describe(watch)}${watch.note ? ` (${watch.note})` : ""}:`;
        const coordinates = watch.threadTs
          ? `Reply with: slackcli messages send --recipient-id ${watch.channel} --thread-ts ${watch.threadTs} --message '…'`
          : `Channel: ${watch.channel}`;
        return `${header}\n\n${messages.map((message) => message.text).join("\n\n")}\n\n${coordinates}`;
      })
      .filter((section): section is string => Boolean(section));
    const body = truncate(sections.join("\n\n---\n\n"), MAX_NOTIFICATION_CHARS);
    return `<slack-watch-harness-notification>\nNot a user message.\n\n${body}\n\nStill watching. Call unwatch_slack when a conversation no longer needs watching.\n</slack-watch-harness-notification>`;
  }

  function flush(ctx: ExtensionContext): void {
    if (state.pending.length === 0 || !ctx.isIdle()) return;
    const watched = new Set(state.watches.map((watch) => watch.key));
    const pending = state.pending.filter((message) => watched.has(message.watchKey));
    if (pending.length === 0) {
      state.pending = [];
      save();
      setStatus(ctx);
      return;
    }
    pi.sendMessage(
      { customType: NOTIFICATION_TYPE, content: buildNotification(pending), display: true },
      { triggerTurn: true },
    );
    state.pending = [];
    save();
    setStatus(ctx);
  }

  function startPolling(ctx: ExtensionContext): void {
    if (interval || state.watches.length === 0) return;
    interval = setInterval(() => poll(ctx).catch(() => undefined), POLL_INTERVAL_MS);
    interval.unref?.();
  }

  function stopPolling(): void {
    if (interval) clearInterval(interval);
    interval = undefined;
  }

  function listWatches(): string {
    if (state.watches.length === 0) return "No Slack watches.";
    return state.watches
      .map((watch) => {
        const extras = [
          watch.from ? `from ${watch.from}` : undefined,
          watch.note,
          watch.lastError ? `error: ${watch.lastError}` : undefined,
        ].filter(Boolean);
        return `- ${describe(watch)}${extras.length > 0 ? ` (${extras.join("; ")})` : ""}`;
      })
      .join("\n");
  }

  async function watch(
    params: { target: string; thread_ts?: string; from?: string; since?: string; note?: string },
    ctx: ExtensionContext,
  ): Promise<string> {
    const parsed = parseSlackTarget(params.target, params.thread_ts);
    // Validates the conversation or thread and resolves the canonical channel ID.
    const probe = await read(parsed, ["--limit=1"]);
    const target = { ...parsed, channel: probe.channel_id ?? parsed.channel };
    const key = watchKey(target);
    const cursor = params.since?.trim() ? normalizeTs(params.since) : (Date.now() / 1000).toFixed(6);
    const existing = state.watches.find((candidate) => candidate.key === key);
    const next: SlackWatch = {
      ...target,
      key,
      cursor: existing && !params.since ? existing.cursor : cursor,
      from: params.from?.trim() || undefined,
      note: params.note?.trim() || existing?.note,
    };
    state.watches = [...state.watches.filter((candidate) => candidate.key !== key), next];
    save();
    startPolling(ctx);
    setStatus(ctx);
    // A since in the past may already have messages waiting.
    if (params.since) await poll(ctx);
    const filter = next.from ? ` from ${next.from}` : "";
    return `Watching ${describe(next)} for new messages${filter} after ${next.cursor}. Return control; Slack Watch will trigger a turn when someone posts.\n\nCurrent watches:\n${listWatches()}`;
  }

  function unwatch(params: { target: string; thread_ts?: string }, ctx: ExtensionContext): string {
    const key = watchKey(parseSlackTarget(params.target, params.thread_ts));
    const before = state.watches.length;
    state.watches = state.watches.filter((candidate) => candidate.key !== key);
    state.pending = state.pending.filter((message) => message.watchKey !== key);
    save();
    if (state.watches.length === 0) stopPolling();
    setStatus(ctx);
    const result = before === state.watches.length ? `Was not watching ${key}.` : `Stopped watching ${key}.`;
    return `${result}\n\nCurrent watches:\n${listWatches()}`;
  }

  pi.on("before_agent_start", (event) => {
    if (state.watches.length === 0) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${HARNESS_GUIDANCE}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    stopPolling();
    state = { watches: [], pending: [] };
    const saved = [...ctx.sessionManager.getBranch()]
      .reverse()
      .find((entry) => entry.type === "custom" && entry.customType === CUSTOM_STATE);
    if (saved?.type === "custom" && isWatchState(saved.data)) {
      state = structuredClone(saved.data);
      state.pending ??= [];
    }
    startPolling(ctx);
    setStatus(ctx);
    // Catch up on anything posted while the session was closed.
    await poll(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  pi.on("agent_settled", async (_event, ctx) => {
    flush(ctx);
  });

  const targetDescription =
    "Slack URL (channel, DM, or message link) or a channel/DM ID. A message link watches that message's thread.";

  pi.registerTool({
    name: "watch_slack",
    label: "Watch Slack",
    description:
      "Watch a Slack channel, DM, or thread in this session. New messages from anyone but you trigger a turn. A channel or DM watch covers top-level messages; a thread watch covers its replies.",
    parameters: Type.Object({
      target: Type.String({ description: targetDescription }),
      thread_ts: Type.Optional(Type.String({ description: "Thread parent ts, to watch a thread given a channel ID" })),
      from: Type.Optional(
        Type.String({
          description:
            "Only wake for messages from this Slack user ID (U…) or bot ID (B…). Bots can post with only their bot ID, so use the B… ID for a bot.",
        }),
      ),
      since: Type.Optional(Type.String({ description: "Also report messages after this ts (default: only messages posted from now on)" })),
      note: Type.Optional(Type.String({ description: "Why you are watching; repeated in each notification" })),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: await watch(params, ctx) }], details: undefined };
    },
  });

  pi.registerTool({
    name: "unwatch_slack",
    label: "Stop watching Slack",
    description: "Stop watching a Slack channel, DM, or thread in this session.",
    parameters: Type.Object({
      target: Type.String({ description: targetDescription }),
      thread_ts: Type.Optional(Type.String({ description: "Thread parent ts, when target is a channel ID" })),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: unwatch(params, ctx) }], details: undefined };
    },
  });

  pi.registerCommand("slack-watch", {
    description: "List Slack watches, poll now, or clear them: /slack-watch [list|poll|clear]",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "list";
      if (action === "poll") {
        await poll(ctx);
      } else if (action === "clear") {
        state = { watches: [], pending: [] };
        save();
        stopPolling();
        setStatus(ctx);
      } else if (action !== "list") {
        ctx.ui.notify("Usage: /slack-watch [list|poll|clear]", "warning");
        return;
      }
      ctx.ui.notify(listWatches(), "info");
    },
  });
}
