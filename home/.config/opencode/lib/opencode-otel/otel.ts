import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ROOT_CONTEXT, SpanKind, trace, type Context, type Span } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

type Runtime = {
  provider: BasicTracerProvider
  tracer: ReturnType<typeof trace.getTracer>
  startSpan: (input: {
    name: string
    parentContext?: Context
    attributes?: Record<string, unknown>
  }) => { span: Span; context: Context }
  shutdown: () => Promise<void>
}

type TelemetryConfig = {
  endpoint: string
  headers?: Record<string, string>
  serviceName?: string
}

const GLOBAL_KEY = '__opencode_otel_tracing_runtime__'
const CONFIG_URL = new URL('../../otel.json', import.meta.url)

const substituteEnv = (text: string) =>
  text.replace(/\{env:([^}]+)\}/g, (_, varName: string) => process.env[varName] || '')

export const readTelemetryConfig = (configURL: URL = CONFIG_URL): TelemetryConfig => {
  const text = readFileSync(configURL, 'utf8')
  const parsed = JSON.parse(substituteEnv(text)) as Partial<TelemetryConfig>
  const configPath = fileURLToPath(configURL)

  if (!parsed.endpoint || typeof parsed.endpoint !== 'string') {
    throw new Error(`Missing 'endpoint' in ${configPath}`)
  }

  if (parsed.headers !== undefined) {
    if (typeof parsed.headers !== 'object' || Array.isArray(parsed.headers)) {
      throw new Error(`Invalid 'headers' in ${configPath}`)
    }

    for (const [key, value] of Object.entries(parsed.headers)) {
      if (typeof value !== 'string') {
        throw new Error(`Invalid header '${key}' in ${configPath}`)
      }
    }
  }

  if (parsed.serviceName !== undefined && typeof parsed.serviceName !== 'string') {
    throw new Error(`Invalid 'serviceName' in ${configPath}`)
  }

  return {
    endpoint: parsed.endpoint,
    headers: parsed.headers,
    serviceName: parsed.serviceName,
  }
}

const createRuntime = (): Runtime => {
  const telemetry = readTelemetryConfig()
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: telemetry.serviceName || 'opencode',
    [ATTR_SERVICE_VERSION]: '0.1.0',
  })
  const exporter = new OTLPTraceExporter({
    url: telemetry.endpoint,
    headers: telemetry.headers,
  })
  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  })

  trace.setGlobalTracerProvider(provider)

  const tracer = trace.getTracer('opencode-otel-tracing', '0.1.0')
  let shutdownPromise: Promise<void> | null = null

  const cleanAttributes = (attributes: Record<string, unknown> = {}) =>
    Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== undefined),
    )

  return {
    provider,
    tracer,
    startSpan({ name, parentContext, attributes }) {
      const baseContext = parentContext || ROOT_CONTEXT
      const span = tracer.startSpan(
        name,
        {
          kind: SpanKind.INTERNAL,
          attributes: cleanAttributes(attributes),
        },
        baseContext,
      )

      return {
        span,
        context: trace.setSpan(baseContext, span),
      }
    },
    async shutdown() {
      if (!shutdownPromise) {
        shutdownPromise = Promise.resolve()
          .then(() => provider.forceFlush())
          .then(() => provider.shutdown())
      }

      await shutdownPromise
    },
  }
}

export const getTelemetryRuntime = (): Runtime => {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Runtime
  }

  if (!globalState[GLOBAL_KEY]) globalState[GLOBAL_KEY] = createRuntime()
  return globalState[GLOBAL_KEY]
}
