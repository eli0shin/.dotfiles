import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { ReviewResult } from "./types.ts";

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
}

/**
 * Run the review as an isolated, in-process pi session via the SDK.
 * Uses default resource discovery (so the code-review is available).
 */
export async function runReview(
  prompt: string,
  cwd: string,
  options: RunReviewOptions = {},
): Promise<ReviewResult> {
  // Isolated session: discover skills (for code-review) but NOT other
  // user extensions, which would otherwise be loaded into the review process.
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    sessionManager: SessionManager.inMemory(cwd),
    resourceLoader: loader,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    tools: ["read", "grep", "find", "ls", "bash"],
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
  session.dispose();
  return { output, aborted, error };
}

export function isReviewFailure(result: ReviewResult): boolean {
  return result.aborted || !!result.error;
}
