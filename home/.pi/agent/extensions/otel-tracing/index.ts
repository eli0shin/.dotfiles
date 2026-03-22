import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getTelemetryRuntime } from "./otel.ts";
import { createTracingLifecycle } from "./state.ts";

const GLOBAL_KEY = "__pi_otel_tracing_extension__";

type PluginState = {
  lifecycle: ReturnType<typeof createTracingLifecycle>;
  runtime: ReturnType<typeof getTelemetryRuntime>;
  initError?: string;
  shutdownRegistered: boolean;
};

const createPluginState = (): PluginState => {
  try {
    const runtime = getTelemetryRuntime();
    const lifecycle = createTracingLifecycle({
      startSpan: runtime.startSpan,
      maxAttributeLength: runtime.config.maxAttributeLength,
    });

    return {
      lifecycle,
      runtime,
      shutdownRegistered: false,
    };
  } catch (error) {
    return {
      lifecycle: createTracingLifecycle({
        startSpan: () => {
          throw new Error("Tracing runtime unavailable");
        },
        maxAttributeLength: 12_000,
      }),
      runtime: {
        config: {
          endpoint: "",
          serviceName: "pi",
          serviceVersion: "0.0.0",
          maxAttributeLength: 12_000,
        },
        startSpan: () => {
          throw new Error("Tracing runtime unavailable");
        },
        shutdown: async () => {},
      },
      initError: error instanceof Error ? error.message : String(error),
      shutdownRegistered: false,
    };
  }
};

const getPluginState = (): PluginState => {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: PluginState;
  };

  if (!globalState[GLOBAL_KEY]) {
    globalState[GLOBAL_KEY] = createPluginState();
  }

  return globalState[GLOBAL_KEY] as PluginState;
};

const getRuntimeMetadata = (ctx: ExtensionContext, pluginState: PluginState) => {
  const header = ctx.sessionManager.getHeader();
  return {
    sessionID: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile(),
    cwd: header?.cwd ?? ctx.cwd,
    parentSession: header?.parentSession,
    name: ctx.sessionManager.getSessionName(),
    userID: pluginState.runtime.config.userId,
  };
};

const getModelMetadata = (ctx: ExtensionContext) => {
  const model = ctx.model as
    | {
        provider?: string;
        id?: string;
        name?: string;
        api?: string | { id?: string };
        reasoning?: boolean;
      }
    | undefined;

  if (!model) return undefined;

  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    api: typeof model.api === "string" ? model.api : model.api?.id,
    reasoning: model.reasoning,
  };
};

const registerShutdown = (pluginState: PluginState) => {
  if (pluginState.shutdownRegistered) return;

  const shutdown = async () => {
    pluginState.lifecycle.closeAll("shutdown");
    await pluginState.runtime.shutdown();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("beforeExit", shutdown);
  pluginState.shutdownRegistered = true;
};

export default function otelTracing(pi: ExtensionAPI): void {
  const pluginState = getPluginState();
  registerShutdown(pluginState);

  pi.on("session_start", async (_event, ctx) => {
    if (pluginState.initError) {
      if (ctx.hasUI) ctx.ui.notify(`otel-tracing disabled: ${pluginState.initError}`, "warning");
      return;
    }

    pluginState.lifecycle.activateSession(getRuntimeMetadata(ctx, pluginState));
  });

  pi.on("session_switch", async (_event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.activateSession(getRuntimeMetadata(ctx, pluginState));
  });

  pi.on("session_fork", async (_event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.activateSession(getRuntimeMetadata(ctx, pluginState));
  });

  pi.on("input", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onInput(
      {
        source: event.source,
      },
      getRuntimeMetadata(ctx, pluginState),
      ctx.isIdle(),
    );
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onBeforeAgentStart(
      {
        prompt: event.prompt,
        images: event.images,
      },
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("turn_start", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onTurnStart({ turnIndex: event.turnIndex }, getRuntimeMetadata(ctx, pluginState));
  });

  pi.on("context", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onContext(event.messages, ctx.getSystemPrompt(), getRuntimeMetadata(ctx, pluginState));
  });

  pi.on("before_provider_request", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onBeforeProviderRequest(
      {
        payload: event.payload,
        model: getModelMetadata(ctx),
        contextUsage: ctx.getContextUsage(),
      },
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("message_start", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onMessageStart(
      event.message as unknown as Record<string, unknown>,
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("message_update", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onMessageUpdate(
      event.assistantMessageEvent as { type?: string; delta?: string },
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("message_end", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onMessageEnd(
      event.message as unknown as Record<string, unknown>,
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onToolExecutionStart(
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      },
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("tool_result", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onToolResult(
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
        content: event.content,
        details: event.details,
        isError: event.isError,
      },
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onToolExecutionEnd(
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      },
      getRuntimeMetadata(ctx, pluginState),
    );
  });

  pi.on("agent_end", async (event, ctx) => {
    if (pluginState.initError) return;
    pluginState.lifecycle.onAgentEnd({ messages: event.messages }, getRuntimeMetadata(ctx, pluginState));
  });

  pi.on("session_shutdown", async () => {
    pluginState.lifecycle.closeAll("shutdown");
    await pluginState.runtime.shutdown();
  });
}
