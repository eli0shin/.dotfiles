type SessionMetadata = {
  sessionID: string;
  sessionFile?: string;
  cwd?: string;
  parentSession?: string;
  name?: string;
};

type RuntimeMetadata = {
  sessionID?: string;
  userID?: string;
};

type UserMessageMetadata = RuntimeMetadata & {
  prompt: string;
  images?: unknown[];
  queued: boolean;
  source?: string;
  messageID?: string;
};

type PromptSnapshot = {
  messages?: unknown[];
  system?: string;
};

type ModelMetadata = {
  provider?: string;
  id?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
};

type ContextUsageMetadata = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

type LlmCallMetadata = RuntimeMetadata & {
  turnIndex?: number | null;
  model?: ModelMetadata;
  prompt?: PromptSnapshot;
  payload?: unknown;
  contextUsage?: ContextUsageMetadata;
};

type AssistantUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

type AssistantMessage = {
  provider?: string;
  model?: string;
  api?: string;
  usage?: AssistantUsage;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  content?: unknown;
};

type ToolStartMetadata = RuntimeMetadata & {
  toolName: string;
  toolCallId: string;
  args?: unknown;
  turnIndex?: number | null;
};

type ToolResultMetadata = RuntimeMetadata & {
  toolName: string;
  toolCallId: string;
  input?: unknown;
  content?: unknown;
  details?: unknown;
  result?: unknown;
  isError: boolean;
};

const IMAGE_PLACEHOLDER = "[image]";
const MAX_SERIALIZE_DEPTH = 6;
const DEFAULT_PREVIEW_LENGTH = 2000;

export const truncateText = (value: string | undefined, maxLength: number): string | undefined => {
  if (value === undefined) return undefined;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
};

const normalizeString = (value: string, maxLength: number): string => truncateText(value, maxLength) ?? "";

const normalizeContentPart = (part: unknown, maxLength: number): unknown => {
  if (!part || typeof part !== "object") return part;

  const record = part as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") {
    return { type: "text", text: normalizeString(record.text, maxLength) };
  }
  if (record.type === "thinking" && typeof record.thinking === "string") {
    return { type: "thinking", thinking: normalizeString(record.thinking, maxLength) };
  }
  if (record.type === "image") {
    return {
      type: "image",
      mimeType: record.mimeType,
      data: IMAGE_PLACEHOLDER,
    };
  }
  if (record.type === "toolCall") {
    return {
      type: "toolCall",
      id: record.id,
      name: record.name,
      arguments: normalizeValue(record.arguments, maxLength, 1),
    };
  }

  return normalizeValue(record, maxLength, 1);
};

const normalizeMessageContent = (content: unknown, maxLength: number): unknown => {
  if (typeof content === "string") return normalizeString(content, maxLength);
  if (!Array.isArray(content)) return content;
  return content.map((part) => normalizeContentPart(part, maxLength));
};

export const joinMessageText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const chunks: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string") chunks.push(record.text);
    else if (typeof record.thinking === "string") chunks.push(record.thinking);
  }
  return chunks.join("\n");
};

const normalizeValue = (value: unknown, maxLength: number, depth = 0): unknown => {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return normalizeString(value, maxLength);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_SERIALIZE_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry, maxLength, depth + 1));

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type) return normalizeContentPart(record, maxLength);

    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (key === "data" && typeof entry === "string") {
        normalized[key] = IMAGE_PLACEHOLDER;
        continue;
      }
      normalized[key] = normalizeValue(entry, maxLength, depth + 1);
    }
    return normalized;
  }

  return String(value);
};

export const safeJson = (value: unknown, maxLength: number): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string") return truncateText(value, maxLength);

  try {
    const normalized = normalizeValue(value, Math.max(128, Math.floor(maxLength / 4)));
    return truncateText(JSON.stringify(normalized), maxLength);
  } catch {
    return truncateText(String(value), maxLength);
  }
};

export const previewText = (value: string | undefined, maxLength = DEFAULT_PREVIEW_LENGTH): string | undefined =>
  truncateText(value, maxLength);

export const serializePromptMessages = (messages: unknown[] | undefined, maxLength: number): string | undefined => {
  if (!messages || messages.length === 0) return undefined;

  const normalized = messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const record = message as Record<string, unknown>;

    const normalizedMessage: Record<string, unknown> = {
      role: record.role,
      content: normalizeMessageContent(record.content, Math.max(256, Math.floor(maxLength / 4))),
    };

    if (typeof record.customType === "string") normalizedMessage.customType = record.customType;
    if (typeof record.toolName === "string") normalizedMessage.toolName = record.toolName;
    if (typeof record.toolCallId === "string") normalizedMessage.toolCallId = record.toolCallId;
    if (typeof record.provider === "string") normalizedMessage.provider = record.provider;
    if (typeof record.model === "string") normalizedMessage.model = record.model;
    if (typeof record.stopReason === "string") normalizedMessage.stopReason = record.stopReason;
    if (record.usage) normalizedMessage.usage = normalizeValue(record.usage, maxLength, 1);

    return normalizedMessage;
  });

  return safeJson(normalized, maxLength);
};

export const sessionAttributes = (session: SessionMetadata) => ({
  "session.id": session.sessionID,
  "session.file": session.sessionFile,
  "session.cwd": session.cwd,
  "session.parent_file": session.parentSession,
  "session.name": session.name,
});

export const userMessageAttributes = (metadata: UserMessageMetadata, maxLength: number) => ({
  "session.id": metadata.sessionID,
  "user.id": metadata.userID,
  "message.id": metadata.messageID,
  "message.role": "user",
  "message.source": metadata.source,
  "message.content": truncateText(metadata.prompt, maxLength),
  "message.image_count": metadata.images?.length ?? 0,
  "message.queued": metadata.queued,
});

export const llmCallAttributes = (metadata: LlmCallMetadata, maxLength: number) => ({
  "session.id": metadata.sessionID,
  "user.id": metadata.userID,
  "llm.turn.index": metadata.turnIndex,
  "llm.model.provider": metadata.model?.provider,
  "llm.model.id": metadata.model?.id,
  "llm.model.name": metadata.model?.name,
  "llm.model.api": metadata.model?.api,
  "llm.model.reasoning": metadata.model?.reasoning,
  "llm.prompt.messages": serializePromptMessages(metadata.prompt?.messages, maxLength),
  "llm.prompt.system": truncateText(metadata.prompt?.system, maxLength),
  "llm.request.payload": safeJson(metadata.payload, maxLength),
  "llm.context.tokens": metadata.contextUsage?.tokens,
  "llm.context.window": metadata.contextUsage?.contextWindow,
  "llm.context.percent": metadata.contextUsage?.percent,
});

export const assistantAttributes = (message: AssistantMessage, maxLength: number) => {
  const outputText = joinMessageText(message.content);
  const toolCalls = Array.isArray(message.content)
    ? message.content
        .filter((part) => part && typeof part === "object" && (part as Record<string, unknown>).type === "toolCall")
        .map((part) => normalizeContentPart(part, maxLength))
    : undefined;

  return {
    "assistant.provider": message.provider,
    "assistant.model": message.model,
    "assistant.api": message.api,
    "assistant.stop_reason": message.stopReason,
    "assistant.error_message": truncateText(message.errorMessage, maxLength),
    "assistant.output.text": truncateText(outputText, maxLength),
    "assistant.tool_calls": safeJson(toolCalls, maxLength),
    "assistant.tokens.input": message.usage?.input,
    "assistant.tokens.output": message.usage?.output,
    "assistant.tokens.cache_read": message.usage?.cacheRead,
    "assistant.tokens.cache_write": message.usage?.cacheWrite,
    "assistant.tokens.total": message.usage?.totalTokens,
    "assistant.cost.input": message.usage?.cost?.input,
    "assistant.cost.output": message.usage?.cost?.output,
    "assistant.cost.cache_read": message.usage?.cost?.cacheRead,
    "assistant.cost.cache_write": message.usage?.cost?.cacheWrite,
    "assistant.cost.total": message.usage?.cost?.total,
  };
};

export const toolStartAttributes = (metadata: ToolStartMetadata, maxLength: number) => ({
  "session.id": metadata.sessionID,
  "user.id": metadata.userID,
  "tool.name": metadata.toolName,
  "tool.call_id": metadata.toolCallId,
  "tool.turn.index": metadata.turnIndex,
  "tool.input": safeJson(metadata.args, maxLength),
});

export const toolResultAttributes = (metadata: ToolResultMetadata, maxLength: number) => ({
  "session.id": metadata.sessionID,
  "user.id": metadata.userID,
  "tool.name": metadata.toolName,
  "tool.call_id": metadata.toolCallId,
  "tool.input": safeJson(metadata.input, maxLength),
  "tool.content": safeJson(metadata.content, maxLength),
  "tool.output": safeJson(metadata.result, maxLength),
  "tool.details": safeJson(metadata.details, maxLength),
  "tool.is_error": metadata.isError,
});
