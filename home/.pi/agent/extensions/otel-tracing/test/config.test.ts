import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getTelemetryRuntime, readTelemetryConfig, resetTelemetryRuntime } from "../otel.ts";

const withTempConfig = (text: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-otel-tracing-"));
  const file = path.join(dir, "otel.json");
  writeFileSync(file, text);

  return {
    file,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

const withEnv = (values: Record<string, string | undefined>, run: () => void) => {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    original.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    run();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const createCaptureServer = async () => {
  const requests: Array<{
    method?: string;
    url?: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine capture server address");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
};

test("reads endpoint, headers, and service values from config", () => {
  const temp = withTempConfig(
    JSON.stringify({
      endpoint: "http://collector:4318/v1/traces",
      headers: { Authorization: "Bearer token" },
      serviceName: "pi-local",
      serviceVersion: "9.9.9",
      userId: "eli",
      maxAttributeLength: 4096,
    }),
  );

  try {
    assert.deepEqual(readTelemetryConfig(new URL(`file://${temp.file}`)), {
      endpoint: "http://collector:4318/v1/traces",
      headers: { Authorization: "Bearer token" },
      serviceName: "pi-local",
      serviceVersion: "9.9.9",
      userId: "eli",
      maxAttributeLength: 4096,
    });
  } finally {
    temp.cleanup();
  }
});

test("interpolates env placeholders", () => {
  withEnv(
    {
      TEST_OTEL_ENDPOINT: "http://collector:4320/v1/traces",
      TEST_OTEL_TOKEN: "secret-token",
      TEST_OTEL_SERVICE: "pi-secret",
    },
    () => {
      const temp = withTempConfig(
        JSON.stringify({
          endpoint: "{env:TEST_OTEL_ENDPOINT}",
          headers: { Authorization: "Bearer {env:TEST_OTEL_TOKEN}" },
          serviceName: "{env:TEST_OTEL_SERVICE}",
        }),
      );

      try {
        const config = readTelemetryConfig(new URL(`file://${temp.file}`));
        assert.equal(config.endpoint, "http://collector:4320/v1/traces");
        assert.deepEqual(config.headers, { Authorization: "Bearer secret-token" });
        assert.equal(config.serviceName, "pi-secret");
      } finally {
        temp.cleanup();
      }
    },
  );
});

test("exports ended spans over OTLP/HTTP on shutdown", async () => {
  resetTelemetryRuntime();
  const server = await createCaptureServer();
  const temp = withTempConfig(
    JSON.stringify({
      endpoint: server.endpoint,
      serviceName: "pi-test",
      serviceVersion: "1.2.3",
    }),
  );
  const originalConfig = process.env.PI_OTEL_CONFIG;
  process.env.PI_OTEL_CONFIG = temp.file;

  try {
    const runtime = getTelemetryRuntime();
    const { span } = runtime.startSpan({
      name: "demo",
      attributes: { "demo.attribute": "value" },
    });

    span.end();
    await runtime.shutdown();

    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0]?.method, "POST");
    assert.equal(server.requests[0]?.url, "/v1/traces");
    assert.ok((server.requests[0]?.body.length ?? 0) > 0);
  } finally {
    if (originalConfig === undefined) delete process.env.PI_OTEL_CONFIG;
    else process.env.PI_OTEL_CONFIG = originalConfig;
    resetTelemetryRuntime();
    temp.cleanup();
    await server.close();
  }
});
