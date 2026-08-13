import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { join } from "node:path";
import type { ReviewResult } from "./types.ts";

const EXA_EXTENSION_PATH = join(getAgentDir(), "git/github.com/d-b/pi-exa/src/index.ts");
export const REVIEW_SESSION_DIR = join(getAgentDir(), "code-review-sessions");
const REVIEW_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "web_search_exa",
  "web_fetch_exa",
];

/** Minimal structural shape of the messages we read. */
type TextPart = { type: string; text?: string };
type ReadableMessage = {
  role: string;
  content?: string | TextPart[];
  stopReason?: string;
  errorMessage?: string;
};

/** Find a model/turn error in the messages (e.g. rate limits), if any. */
export function findReviewError(messages: readonly ReadableMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.errorMessage) return msg.errorMessage;
    if (msg.stopReason === "error") return "model turn ended with an error";
  }
  return undefined;
}

/** Extract the final assistant text from a message list. */
export function getFinalAssistantText(messages: readonly ReadableMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || msg.content == null) continue;
    const text =
      typeof msg.content === "string"
        ? msg.content.trim()
        : msg.content
            .filter((c) => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text as string)
            .join("\n")
            .trim();
    if (text) return text;
  }
  return "";
}

export interface RunReviewOptions {
  signal?: AbortSignal;
  /** Use the caller's currently selected model instead of pi's default model. */
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  /** Called with the streaming review text as it grows. */
  onText?: (text: string) => void;
  /** Existing review session ID to continue. Omit to start a new review. */
  sessionId?: string;
}

/** Resolve a full review session ID in the dedicated directory for this cwd. */
export async function findReviewSession(
  sessionId: string,
  cwd: string,
  sessionDir = REVIEW_SESSION_DIR,
): Promise<string> {
  const requestedId = sessionId.trim();
  if (!requestedId) throw new Error("Review session ID is required");

  const sessions = await SessionManager.list(cwd, sessionDir);
  const match = sessions.find((candidate) => candidate.id === requestedId);
  if (!match) throw new Error(`Review session not found for this project: ${requestedId}`);
  return match.path;
}

/**
 * Run a new review or continue an existing review in an isolated, persistent
 * pi session. Review JSONL files use a dedicated directory.
 */
export async function runReview(
  prompt: string,
  cwd: string,
  options: RunReviewOptions = {},
): Promise<ReviewResult> {
  // Isolated session: discover skills and load only the Exa extension. Other
  // user extensions stay disabled so they cannot affect the review process.
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    additionalExtensionPaths: [EXA_EXTENSION_PATH],
  });
  await loader.reload();

  const sessionManager = options.sessionId
    ? SessionManager.open(
        await findReviewSession(options.sessionId, cwd),
        REVIEW_SESSION_DIR,
        cwd,
      )
    : SessionManager.create(cwd, REVIEW_SESSION_DIR);

  const { session } = await createAgentSession({
    cwd,
    sessionManager,
    resourceLoader: loader,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    tools: REVIEW_TOOLS,
  });

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    void session.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  const unsubscribe = options.onText
    ? session.subscribe(() => options.onText?.(getFinalAssistantText(session.messages)))
    : undefined;

  let error: string | undefined;
  try {
    await session.prompt(prompt);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    unsubscribe?.();
  }

  const output = getFinalAssistantText(session.messages);
  // Surface model/turn errors (e.g. rate limits) that don't throw.
  error = error ?? findReviewError(session.messages);
  if (!output.trim() && !aborted) {
    error = error ?? "review completed with no assistant output";
  }
  const sessionId = session.sessionId;
  const sessionFile = session.sessionFile;
  try {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  } catch (e) {
    error = error ?? (e instanceof Error ? e.message : String(e));
  } finally {
    session.dispose();
  }
  return { output, sessionId, sessionFile, aborted, error };
}

export function isReviewFailure(result: ReviewResult): boolean {
  return result.aborted || !!result.error;
}
