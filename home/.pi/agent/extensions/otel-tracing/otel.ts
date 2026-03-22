import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ROOT_CONTEXT, SpanKind, trace, type Attributes, type Context, type Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export type TelemetryConfig = {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
  serviceVersion?: string;
  userId?: string;
  maxAttributeLength?: number;
};

type Runtime = {
  config: Required<Pick<TelemetryConfig, "endpoint" | "serviceName" | "serviceVersion" | "maxAttributeLength">> & {
    headers?: Record<string, string>;
    userId?: string;
  };
  startSpan: (input: {
    name: string;
    parentContext?: Context;
    attributes?: Record<string, unknown>;
  }) => { span: Span; context: Context };
  shutdown: () => Promise<void>;
};

const GLOBAL_KEY = "__pi_otel_tracing_runtime__";
const DEFAULT_ENDPOINT = "http://localhost:4318/v1/traces";
const DEFAULT_MAX_ATTRIBUTE_LENGTH = 12_000;
const CONFIG_CANDIDATES = [new URL("./otel.json", import.meta.url), new URL("./otel.base.json", import.meta.url)];

const substituteEnv = (text: string): string =>
  text.replace(/\{env:([^}]+)\}/g, (_, variable: string) => process.env[variable] ?? "");

const getPackageVersion = (): string => {
  try {
    const packageUrl = new URL("./package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(packageUrl, "utf8")) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
};

const resolveConfigUrl = (): URL | null => {
  const override = process.env["PI_OTEL_CONFIG"];
  if (override) {
    const overrideUrl = override.startsWith("file:") ? new URL(override) : pathToFileURL(override);
    if (existsSync(fileURLToPath(overrideUrl))) return overrideUrl;
    throw new Error(`PI_OTEL_CONFIG does not exist: ${override}`);
  }

  for (const candidate of CONFIG_CANDIDATES) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }

  return null;
};

export const readTelemetryConfig = (configUrl: URL | null = resolveConfigUrl()): Runtime["config"] => {
  const defaults: Runtime["config"] = {
    endpoint: DEFAULT_ENDPOINT,
    serviceName: "pi",
    serviceVersion: getPackageVersion(),
    userId: process.env["USER"] || process.env["USERNAME"],
    maxAttributeLength: DEFAULT_MAX_ATTRIBUTE_LENGTH,
  };

  if (!configUrl) return defaults;

  const text = readFileSync(configUrl, "utf8");
  const parsed = JSON.parse(substituteEnv(text)) as TelemetryConfig;
  const configPath = fileURLToPath(configUrl);

  if (parsed.endpoint !== undefined && typeof parsed.endpoint !== "string") {
    throw new Error(`Invalid 'endpoint' in ${configPath}`);
  }

  if (parsed.headers !== undefined) {
    if (typeof parsed.headers !== "object" || Array.isArray(parsed.headers)) {
      throw new Error(`Invalid 'headers' in ${configPath}`);
    }

    for (const [key, value] of Object.entries(parsed.headers)) {
      if (typeof value !== "string") {
        throw new Error(`Invalid header '${key}' in ${configPath}`);
      }
    }
  }

  if (parsed.serviceName !== undefined && typeof parsed.serviceName !== "string") {
    throw new Error(`Invalid 'serviceName' in ${configPath}`);
  }

  if (parsed.serviceVersion !== undefined && typeof parsed.serviceVersion !== "string") {
    throw new Error(`Invalid 'serviceVersion' in ${configPath}`);
  }

  if (parsed.userId !== undefined && typeof parsed.userId !== "string") {
    throw new Error(`Invalid 'userId' in ${configPath}`);
  }

  if (parsed.maxAttributeLength !== undefined && typeof parsed.maxAttributeLength !== "number") {
    throw new Error(`Invalid 'maxAttributeLength' in ${configPath}`);
  }

  return {
    endpoint: parsed.endpoint ?? defaults.endpoint,
    headers: parsed.headers,
    serviceName: parsed.serviceName ?? defaults.serviceName,
    serviceVersion: parsed.serviceVersion ?? defaults.serviceVersion,
    userId: parsed.userId ?? defaults.userId,
    maxAttributeLength: parsed.maxAttributeLength ?? defaults.maxAttributeLength,
  };
};

const createRuntime = (): Runtime => {
  const config = readTelemetryConfig();
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
  });

  const exporter = new OTLPTraceExporter({
    url: config.endpoint,
    headers: config.headers,
  });

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  trace.setGlobalTracerProvider(provider);

  const tracer = trace.getTracer("pi-otel-tracing", config.serviceVersion);
  let shutdownPromise: Promise<void> | null = null;

  const cleanAttributes = (attributes: Record<string, unknown> = {}): Attributes =>
    Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== undefined),
    ) as Attributes;

  return {
    config,
    startSpan({ name, parentContext, attributes }) {
      const baseContext = parentContext ?? ROOT_CONTEXT;
      const span = tracer.startSpan(
        name,
        {
          kind: SpanKind.INTERNAL,
          attributes: cleanAttributes(attributes),
        },
        baseContext,
      );

      return {
        span,
        context: trace.setSpan(baseContext, span),
      };
    },
    async shutdown() {
      if (!shutdownPromise) {
        shutdownPromise = Promise.resolve()
          .then(() => provider.forceFlush())
          .then(() => provider.shutdown());
      }

      await shutdownPromise;
    },
  };
};

export const getTelemetryRuntime = (): Runtime => {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Runtime;
  };

  if (!globalState[GLOBAL_KEY]) {
    globalState[GLOBAL_KEY] = createRuntime();
  }

  return globalState[GLOBAL_KEY];
};

export const resetTelemetryRuntime = () => {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Runtime;
  };

  delete globalState[GLOBAL_KEY];
};
