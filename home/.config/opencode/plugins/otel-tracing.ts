import type { Hooks } from '@opencode-ai/plugin'

import { getTelemetryRuntime } from '../lib/opencode-otel/otel.ts'
import { createTracingLifecycle } from '../lib/opencode-otel/state.ts'

const GLOBAL_KEY = '__opencode_otel_tracing_plugin__'

type PluginState = {
  lifecycle: ReturnType<typeof createTracingLifecycle>
  runtime: ReturnType<typeof getTelemetryRuntime>
  shutdownRegistered: boolean
}

export default function OtelTracingPlugin(): Hooks {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: PluginState
  }

  if (!globalState[GLOBAL_KEY]) {
    const runtime = getTelemetryRuntime()
    const lifecycle = createTracingLifecycle({ startSpan: runtime.startSpan })

    globalState[GLOBAL_KEY] = {
      lifecycle,
      runtime,
      shutdownRegistered: false,
    }
  }

  const pluginState = globalState[GLOBAL_KEY] as PluginState

  if (!pluginState.shutdownRegistered) {
    const shutdown = async () => {
      pluginState.lifecycle.shutdown()
      await pluginState.runtime.shutdown()
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    process.once('beforeExit', shutdown)
    pluginState.shutdownRegistered = true
  }

  return {
    event: async ({ event }) => {
      pluginState.lifecycle.onEvent(event)

      if (event?.type === 'server.instance.disposed') {
        pluginState.lifecycle.shutdown()
        await pluginState.runtime.shutdown()
      }
    },
    'chat.message': async (input, output) => {
      pluginState.lifecycle.onChatMessage(input, output)
    },
    'chat.params': async (input, output) => {
      pluginState.lifecycle.onChatParams(input, output)
    },
    'tool.execute.before': async (input, output) => {
      pluginState.lifecycle.onToolExecuteBefore(input, output)
    },
    'tool.execute.after': async (input, output) => {
      pluginState.lifecycle.onToolExecuteAfter(input, output)
    },
  }
}
