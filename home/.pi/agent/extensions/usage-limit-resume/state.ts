import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { subscriptionLimit } from "../claude-bridge/src/rate-limit.ts";

export const STATE_TYPE = "usage-limit-resume-state";
export const CONTINUATION_TYPE = "pi-usage-limit-resumed";
export const RESUME_GRACE_MS = 120_000;
const MAX_ATTEMPTS = 3;
const MAX_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
export const MAX_OVERDUE_MS = 24 * 60 * 60 * 1000;

export type QuotaWait = {
  failureId: string;
  window: string;
  resetAt: number;
  dueAt: number;
  attempt: number;
  sameResetRetry: boolean;
};

function isQuotaWait(value: unknown): value is QuotaWait {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<QuotaWait>;
  return typeof v.failureId === "string" && typeof v.window === "string" &&
    typeof v.resetAt === "number" && Number.isSafeInteger(v.resetAt) && v.resetAt > 0 &&
    typeof v.dueAt === "number" && Number.isSafeInteger(v.dueAt) && v.dueAt >= v.resetAt && v.dueAt <= 8.64e15 &&
    typeof v.attempt === "number" && Number.isSafeInteger(v.attempt) && v.attempt >= 1 && v.attempt <= MAX_ATTEMPTS &&
    typeof v.sameResetRetry === "boolean";
}

function findLast(branch: readonly SessionEntry[], matches: (entry: SessionEntry) => boolean) {
  for (let i = branch.length - 1; i >= 0; i--) if (matches(branch[i]!)) return branch[i];
}

export function lastConversationEntry(branch: readonly SessionEntry[]) {
  return findLast(branch, (entry) => entry.type === "custom_message" ||
    (entry.type === "message" && entry.message.role !== "system"));
}

export function quotaFailure(ctx: ExtensionContext, entry: SessionEntry | undefined) {
  if (entry?.type !== "message" || entry.message.role !== "assistant" || entry.message.stopReason !== "error" ||
    entry.message.provider !== "claude-bridge" || ctx.model?.provider !== entry.message.provider ||
    ctx.model.id !== entry.message.model) return;
  return subscriptionLimit(entry.message);
}

export function pendingQuotaWait(ctx: ExtensionContext): QuotaWait | undefined {
  const branch = ctx.sessionManager.getBranch();
  const record = findLast(branch, (entry) => entry.type === "custom" && entry.customType === STATE_TYPE);
  if (record?.type !== "custom" || !isQuotaWait(record.data)) return;
  const failure = lastConversationEntry(branch);
  const limit = quotaFailure(ctx, failure);
  if (failure?.id !== record.data.failureId || limit?.resetAt !== record.data.resetAt || limit.window !== record.data.window) return;
  return record.data;
}

export function latestQuotaContinuation(ctx: ExtensionContext) {
  const entry = findLast(ctx.sessionManager.getBranch(), (entry) =>
    entry.type === "custom_message" && entry.customType === CONTINUATION_TYPE && isQuotaWait(entry.details));
  if (entry?.type === "custom_message" && isQuotaWait(entry.details)) {
    return { id: entry.id, failureId: entry.details.failureId };
  }
}

export function planQuotaWait(
  failureId: string,
  limit: { window: string; resetAt: number },
  prior: QuotaWait | undefined,
  now: number,
  jitter: number,
): QuotaWait | undefined {
  const attempt = (prior?.attempt ?? 0) + 1;
  if (attempt > MAX_ATTEMPTS || limit.resetAt > now + MAX_WINDOW_MS) return;
  const sameReset = prior?.resetAt === limit.resetAt;
  if (sameReset ? prior.sameResetRetry : limit.resetAt <= now) return;
  return {
    failureId, ...limit, attempt, sameResetRetry: sameReset,
    dueAt: Math.max(now, limit.resetAt) + RESUME_GRACE_MS + jitter,
  };
}
