import { SpanStatusCode, type Context, type Span, type SpanStatus } from "@opentelemetry/api";

import {
  assistantAttributes,
  joinMessageText,
  llmCallAttributes,
  previewText,
  sessionAttributes,
  toolResultAttributes,
  toolStartAttributes,
  truncateText,
  userMessageAttributes,
} from "./spans.ts";

type StartSpan = (input: {
  name: string;
  parentContext?: Context;
  attributes?: Record<string, unknown>;
}) => { span: Span; context: Context };

type SessionMetadata = {
  sessionID: string;
  sessionFile?: string;
  cwd?: string;
  parentSession?: string;
  name?: string;
};

type RuntimeMetadata = SessionMetadata & {
  userID?: string;
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

type InputMetadata = {
  source: string;
};

type BeforeAgentStartMetadata = {
  prompt: string;
  images?: unknown[];
};

type TurnStartMetadata = {
  turnIndex: number;
};

type ProviderRequestMetadata = {
  payload?: unknown;
  model?: ModelMetadata;
  contextUsage?: ContextUsageMetadata;
};

type AssistantMessageEvent = {
  type?: string;
  delta?: string;
};

type MessageMetadata = {
  role?: string;
  content?: unknown;
  id?: string;
  provider?: string;
  model?: string;
  api?: string;
  usage?: {
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
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
};

type ToolStartMetadata = {
  toolCallId: string;
  toolName: string;
  args?: unknown;
};

type ToolResultMetadata = {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  content?: unknown;
  details?: unknown;
  isError: boolean;
};

type ToolEndMetadata = {
  toolCallId: string;
  toolName: string;
  result?: unknown;
  isError: boolean;
};

type AgentEndMetadata = {
  messages?: unknown[];
};

type SpanEntry = {
  span: Span;
  context: Context;
  ended: boolean;
};

type SessionEntry = SpanEntry & {
  sessionID: string;
  pendingInputs: PendingInput[];
  activeUserKey: string | null;
  activeLlmKey: string | null;
  currentTurnIndex: number | null;
  promptSnapshot: PromptSnapshot | null;
};

type PendingInput = {
  key: string;
  queued: boolean;
  parentContext: Context;
  parentUserKey: string | null;
  source: string;
};

type UserMessageEntry = SpanEntry & {
  key: string;
  sessionID: string;
  messageID?: string;
  queued: boolean;
  parentUserKey: string | null;
  completed: boolean;
  source?: string;
};

type LlmCallEntry = SpanEntry & {
  key: string;
  sessionID: string;
  parentUserKey: string | null;
  text: string;
  thinking: string;
  startedAt: number;
  firstChunkAt: number | null;
};

type ToolEntry = SpanEntry & {
  toolCallId: string;
  sessionID: string;
};

const openSpan = ({
  startSpan,
  name,
  parentContext,
  attributes,
}: {
  startSpan: StartSpan;
  name: string;
  parentContext?: Context;
  attributes?: Record<string, unknown>;
}): SpanEntry => {
  const { span, context } = startSpan({ name, parentContext, attributes });
  return { span, context, ended: false };
};

const setDefinedAttributes = (span: Span, attributes: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) span.setAttribute(key, value as string | number | boolean);
  }
};

const endSpan = (entry: SpanEntry | null | undefined, status?: SpanStatus) => {
  if (!entry || entry.ended) return;
  if (status) entry.span.setStatus(status);
  entry.span.end();
  entry.ended = true;
};

const getMessageId = (message: MessageMetadata | undefined): string | undefined => {
  if (!message || typeof message !== "object") return undefined;
  return typeof message.id === "string" ? message.id : undefined;
};

const isErrorReason = (reason: string): boolean =>
  reason !== "shutdown" && reason !== "session switched";

const getRuntimeMeta = (runtime: RuntimeMetadata) => ({
  sessionID: runtime.sessionID,
  userID: runtime.userID,
});

export const createTracingLifecycle = ({
  startSpan,
  maxAttributeLength,
}: {
  startSpan: StartSpan;
  maxAttributeLength: number;
}) => {
  const state = {
    sessions: new Map<string, SessionEntry>(),
    userMessages: new Map<string, UserMessageEntry>(),
    llmCalls: new Map<string, LlmCallEntry>(),
    toolCalls: new Map<string, ToolEntry>(),
    sequence: 0,
  };

  const nextKey = (prefix: string) => {
    state.sequence += 1;
    return `${prefix}-${state.sequence}`;
  };

  const ensureSession = (runtime: RuntimeMetadata): SessionEntry => {
    let session = state.sessions.get(runtime.sessionID);
    if (!session) {
      const spanEntry = openSpan({
        startSpan,
        name: "session",
        attributes: sessionAttributes(runtime),
      });
      session = {
        ...spanEntry,
        sessionID: runtime.sessionID,
        pendingInputs: [],
        activeUserKey: null,
        activeLlmKey: null,
        currentTurnIndex: null,
        promptSnapshot: null,
      };
      state.sessions.set(runtime.sessionID, session);
      return session;
    }

    setDefinedAttributes(session.span, sessionAttributes(runtime));
    return session;
  };

  const getSession = (runtime: RuntimeMetadata): SessionEntry | null => state.sessions.get(runtime.sessionID) ?? null;

  const getUserEntry = (userKey: string | null | undefined): UserMessageEntry | null => {
    if (!userKey) return null;
    return state.userMessages.get(userKey) ?? null;
  };

  const getActiveUser = (session: SessionEntry): UserMessageEntry | null => getUserEntry(session.activeUserKey);

  const getActiveLlm = (session: SessionEntry): LlmCallEntry | null => {
    if (!session.activeLlmKey) return null;
    return state.llmCalls.get(session.activeLlmKey) ?? null;
  };

  const hasPendingChildren = (session: SessionEntry, userKey: string): boolean =>
    session.pendingInputs.some((pending) => pending.parentUserKey === userKey);

  const hasOpenChildren = (userKey: string): boolean => {
    for (const entry of state.userMessages.values()) {
      if (entry.parentUserKey === userKey) return true;
    }
    return false;
  };

  const maybeEndUser = (session: SessionEntry, userKey: string | null | undefined) => {
    if (!userKey) return;

    const entry = state.userMessages.get(userKey);
    if (!entry || !entry.completed) return;
    if (hasPendingChildren(session, userKey)) return;
    if (hasOpenChildren(userKey)) return;

    endSpan(entry);
    state.userMessages.delete(userKey);

    if (entry.parentUserKey) {
      maybeEndUser(session, entry.parentUserKey);
    }
  };

  const bindUserMessage = (session: SessionEntry, message: MessageMetadata) => {
    const activeUser = getActiveUser(session);
    if (!activeUser) return;

    const messageID = getMessageId(message);
    if (messageID && !activeUser.messageID) activeUser.messageID = messageID;

    setDefinedAttributes(
      activeUser.span,
      userMessageAttributes(
        {
          ...getRuntimeMeta({ sessionID: session.sessionID }),
          prompt: joinMessageText(message.content),
          queued: activeUser.queued,
          source: activeUser.source,
          messageID,
        },
        maxAttributeLength,
      ),
    );
  };

  const bindAssistantMessage = (session: SessionEntry, message: MessageMetadata) => {
    const activeLlm = getActiveLlm(session);
    if (!activeLlm) return;

    const outputText = joinMessageText(message.content);
    if (outputText && !activeLlm.text) {
      activeLlm.text = outputText;
      setDefinedAttributes(activeLlm.span, {
        "llm.output.preview": previewText(outputText),
        "llm.output.text": truncateText(outputText, maxAttributeLength),
      });
    }

    setDefinedAttributes(activeLlm.span, assistantAttributes(message, maxAttributeLength));

    if (message.errorMessage || message.stopReason === "error") {
      activeLlm.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: message.errorMessage ?? "assistant error",
      });
    }

    activeLlm.span.setAttribute("llm.response.ms_to_finish", Date.now() - activeLlm.startedAt);
  };

  const cleanupOpenTools = (sessionID: string, reason: string) => {
    for (const [toolCallId, tool] of state.toolCalls.entries()) {
      if (tool.sessionID !== sessionID) continue;
      endSpan(tool, isErrorReason(reason) ? { code: SpanStatusCode.ERROR, message: reason } : undefined);
      state.toolCalls.delete(toolCallId);
    }
  };

  const closeSession = (sessionID: string, reason: string) => {
    const session = state.sessions.get(sessionID);
    if (!session) return;

    const activeLlm = getActiveLlm(session);
    endSpan(activeLlm, isErrorReason(reason) ? { code: SpanStatusCode.ERROR, message: reason } : undefined);
    if (session.activeLlmKey) state.llmCalls.delete(session.activeLlmKey);
    session.activeLlmKey = null;

    cleanupOpenTools(sessionID, reason);

    for (const [key, user] of state.userMessages.entries()) {
      if (user.sessionID !== sessionID) continue;
      endSpan(user, isErrorReason(reason) ? { code: SpanStatusCode.ERROR, message: reason } : undefined);
      state.userMessages.delete(key);
    }

    session.pendingInputs = [];
    endSpan(session, isErrorReason(reason) ? { code: SpanStatusCode.ERROR, message: reason } : undefined);
    state.sessions.delete(sessionID);
  };

  return {
    activateSession(runtime: RuntimeMetadata) {
      for (const existingSessionID of [...state.sessions.keys()]) {
        if (existingSessionID !== runtime.sessionID) closeSession(existingSessionID, "session switched");
      }
      ensureSession(runtime);
    },

    onInput(input: InputMetadata, runtime: RuntimeMetadata, idle: boolean) {
      const session = ensureSession(runtime);
      const activeUser = getActiveUser(session);
      const queued = Boolean(activeUser) || !idle;

      session.pendingInputs.push({
        key: nextKey("pending-input"),
        queued,
        parentContext: activeUser?.context ?? session.context,
        parentUserKey: activeUser?.key ?? null,
        source: input.source,
      });
    },

    onBeforeAgentStart(input: BeforeAgentStartMetadata, runtime: RuntimeMetadata) {
      const session = ensureSession(runtime);
      const pending = session.pendingInputs.shift();
      const queued = pending?.queued ?? false;
      const parentUserKey = pending?.parentUserKey ?? null;
      const parentContext = pending?.parentContext ?? session.context;
      const userKey = nextKey("user-message");

      const entry = openSpan({
        startSpan,
        name: queued ? "queued_user_message" : "user_message",
        parentContext,
        attributes: userMessageAttributes(
          {
            ...getRuntimeMeta(runtime),
            prompt: input.prompt,
            images: input.images,
            queued,
            source: pending?.source,
          },
          maxAttributeLength,
        ),
      });

      state.userMessages.set(userKey, {
        ...entry,
        key: userKey,
        sessionID: runtime.sessionID,
        queued,
        parentUserKey,
        completed: false,
        source: pending?.source,
      });

      session.activeUserKey = userKey;
    },

    onTurnStart(turn: TurnStartMetadata, runtime: RuntimeMetadata) {
      const session = ensureSession(runtime);
      session.currentTurnIndex = turn.turnIndex;
    },

    onContext(messages: unknown[], systemPrompt: string, runtime: RuntimeMetadata) {
      const session = ensureSession(runtime);
      session.promptSnapshot = { messages, system: systemPrompt };
    },

    onBeforeProviderRequest(request: ProviderRequestMetadata, runtime: RuntimeMetadata) {
      const session = ensureSession(runtime);
      const activeUser = getActiveUser(session);
      const parentContext = activeUser?.context ?? session.context;

      const previousLlm = getActiveLlm(session);
      if (previousLlm) {
        endSpan(previousLlm);
        state.llmCalls.delete(previousLlm.key);
      }

      const llmKey = nextKey("llm-call");
      const entry = openSpan({
        startSpan,
        name: "llm_call",
        parentContext,
        attributes: llmCallAttributes(
          {
            ...getRuntimeMeta(runtime),
            turnIndex: session.currentTurnIndex,
            model: request.model,
            prompt: session.promptSnapshot ?? undefined,
            payload: request.payload,
            contextUsage: request.contextUsage,
          },
          maxAttributeLength,
        ),
      });

      state.llmCalls.set(llmKey, {
        ...entry,
        key: llmKey,
        sessionID: runtime.sessionID,
        parentUserKey: activeUser?.key ?? null,
        text: "",
        thinking: "",
        startedAt: Date.now(),
        firstChunkAt: null,
      });

      session.activeLlmKey = llmKey;
    },

    onMessageStart(message: MessageMetadata, runtime: RuntimeMetadata) {
      const session = ensureSession(runtime);
      if (message.role === "user") {
        bindUserMessage(session, message);
      }
    },

    onMessageUpdate(event: AssistantMessageEvent, runtime: RuntimeMetadata) {
      const session = getSession(runtime);
      if (!session) return;

      const activeLlm = getActiveLlm(session);
      if (!activeLlm) return;

      if (event.type === "text_delta" && typeof event.delta === "string") {
        if (activeLlm.firstChunkAt === null) {
          activeLlm.firstChunkAt = Date.now();
          activeLlm.span.setAttribute(
            "llm.response.ms_to_first_chunk",
            activeLlm.firstChunkAt - activeLlm.startedAt,
          );
        }
        activeLlm.text += event.delta;
        setDefinedAttributes(activeLlm.span, {
          "llm.output.preview": previewText(activeLlm.text),
          "llm.output.text": truncateText(activeLlm.text, maxAttributeLength),
        });
      }

      if (event.type === "thinking_delta" && typeof event.delta === "string") {
        activeLlm.thinking += event.delta;
        setDefinedAttributes(activeLlm.span, {
          "llm.reasoning.preview": previewText(activeLlm.thinking),
          "llm.reasoning.text": truncateText(activeLlm.thinking, maxAttributeLength),
        });
      }
    },

    onMessageEnd(message: MessageMetadata, runtime: RuntimeMetadata) {
      const session = getSession(runtime);
      if (!session) return;

      if (message.role === "user") {
        bindUserMessage(session, message);
        return;
      }

      if (message.role === "assistant") {
        bindAssistantMessage(session, message);
      }
    },

    onToolExecutionStart(tool: ToolStartMetadata, runtime: RuntimeMetadata) {
      const session = ensureSession(runtime);
      const activeLlm = getActiveLlm(session);
      const activeUser = getActiveUser(session);
      const parentContext = activeLlm?.context ?? activeUser?.context ?? session.context;

      const entry = openSpan({
        startSpan,
        name: "tool_call",
        parentContext,
        attributes: toolStartAttributes(
          {
            ...getRuntimeMeta(runtime),
            toolName: tool.toolName,
            toolCallId: tool.toolCallId,
            args: tool.args,
            turnIndex: session.currentTurnIndex,
          },
          maxAttributeLength,
        ),
      });

      state.toolCalls.set(tool.toolCallId, {
        ...entry,
        toolCallId: tool.toolCallId,
        sessionID: runtime.sessionID,
      });
    },

    onToolResult(tool: ToolResultMetadata, runtime: RuntimeMetadata) {
      const entry = state.toolCalls.get(tool.toolCallId);
      if (!entry) return;

      setDefinedAttributes(
        entry.span,
        toolResultAttributes(
          {
            ...getRuntimeMeta(runtime),
            toolName: tool.toolName,
            toolCallId: tool.toolCallId,
            input: tool.input,
            content: tool.content,
            details: tool.details,
            isError: tool.isError,
          },
          maxAttributeLength,
        ),
      );

      if (tool.isError) {
        entry.span.setStatus({ code: SpanStatusCode.ERROR, message: "tool error" });
      }
    },

    onToolExecutionEnd(tool: ToolEndMetadata, runtime: RuntimeMetadata) {
      const entry = state.toolCalls.get(tool.toolCallId);
      if (!entry) return;

      setDefinedAttributes(
        entry.span,
        toolResultAttributes(
          {
            ...getRuntimeMeta(runtime),
            toolName: tool.toolName,
            toolCallId: tool.toolCallId,
            result: tool.result,
            isError: tool.isError,
          },
          maxAttributeLength,
        ),
      );

      endSpan(
        entry,
        tool.isError ? { code: SpanStatusCode.ERROR, message: "tool execution failed" } : undefined,
      );
      state.toolCalls.delete(tool.toolCallId);
    },

    onAgentEnd(_event: AgentEndMetadata, runtime: RuntimeMetadata) {
      const session = getSession(runtime);
      if (!session) return;

      const activeLlm = getActiveLlm(session);
      if (activeLlm) {
        endSpan(activeLlm);
        state.llmCalls.delete(activeLlm.key);
        session.activeLlmKey = null;
      }

      cleanupOpenTools(runtime.sessionID, "agent ended");

      const activeUser = getActiveUser(session);
      if (!activeUser) return;

      activeUser.completed = true;
      session.activeUserKey = null;
      maybeEndUser(session, activeUser.key);
    },

    closeAll(reason = "shutdown") {
      for (const sessionID of [...state.sessions.keys()]) {
        closeSession(sessionID, reason);
      }
    },
  };
};
