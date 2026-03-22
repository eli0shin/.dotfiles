import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getTelemetryRuntime, readTelemetryConfig, resetTelemetryRuntime } from '../lib/opencode-otel/otel.ts'

const withTempConfig = (text: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'opencode-otel-'))
  const file = path.join(dir, 'otel.json')
  writeFileSync(file, text)

  return {
    file,
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const withEnv = (values: Record<string, string | undefined>, run: () => void) => {
  const original = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(values)) {
    original.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  try {
    run()
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('readTelemetryConfig', () => {
  test('reads endpoint, headers, and service name from otel.json', () => {
    const temp = withTempConfig(
      JSON.stringify({
        endpoint: 'http://collector:4318/v1/traces',
        headers: { Authorization: 'Bearer token' },
        serviceName: 'opencode-local',
      }),
    )

    try {
      expect(readTelemetryConfig(new URL(`file://${temp.file}`))).toEqual({
        endpoint: 'http://collector:4318/v1/traces',
        headers: { Authorization: 'Bearer token' },
        serviceName: 'opencode-local',
      })
    } finally {
      temp.cleanup()
    }
  })

  test('rejects invalid header values', () => {
    const temp = withTempConfig(
      JSON.stringify({
        endpoint: 'http://collector:4318/v1/traces',
        headers: { Authorization: 123 },
      }),
    )

    try {
      expect(() => readTelemetryConfig(new URL(`file://${temp.file}`))).toThrow(
        "Invalid header 'Authorization'",
      )
    } finally {
      temp.cleanup()
    }
  })

  test('interpolates env placeholders in otel config values', () => {
    withEnv(
      {
        CLICKSTACK_OTLP_ENDPOINT: 'http://collector:4320/v1/traces',
        CLICKSTACK_INGEST_TOKEN: 'token-123',
        CLICKSTACK_SERVICE_NAME: 'opencode-secret',
      },
      () => {
        const temp = withTempConfig(
          JSON.stringify({
            endpoint: '{env:CLICKSTACK_OTLP_ENDPOINT}',
            headers: { authorization: 'Bearer {env:CLICKSTACK_INGEST_TOKEN}' },
            serviceName: '{env:CLICKSTACK_SERVICE_NAME}',
          }),
        )

        try {
          expect(readTelemetryConfig(new URL(`file://${temp.file}`))).toEqual({
            endpoint: 'http://collector:4320/v1/traces',
            headers: { authorization: 'Bearer token-123' },
            serviceName: 'opencode-secret',
          })
        } finally {
          temp.cleanup()
        }
      },
    )
  })

  test('replaces missing env placeholders with empty strings', () => {
    withEnv(
      {
        MISSING_TOKEN: undefined,
      },
      () => {
        const temp = withTempConfig(
          JSON.stringify({
            endpoint: 'http://collector:4320/v1/traces',
            headers: { authorization: '{env:MISSING_TOKEN}' },
          }),
        )

        try {
          expect(readTelemetryConfig(new URL(`file://${temp.file}`))).toEqual({
            endpoint: 'http://collector:4320/v1/traces',
            headers: { authorization: '' },
            serviceName: undefined,
          })
        } finally {
          temp.cleanup()
        }
      },
    )
  })

  test('recreates the telemetry runtime after reset', async () => {
    resetTelemetryRuntime()
    const first = getTelemetryRuntime()

    resetTelemetryRuntime()
    const second = getTelemetryRuntime()

    try {
      expect(second).not.toBe(first)
    } finally {
      await second.shutdown()
      resetTelemetryRuntime()
    }
  })
})
