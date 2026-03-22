import { mkdir, appendFile, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const env = process.env
const logToFile = env.LOG_REQUESTS === 'true'
const root = path.join(
  env.HOME || '~',
  '.config',
  'opencode',
  'logs',
  'ai-fetch',
)
const events = path.join(root, 'events.ndjson')
const bodies = path.join(root, 'bodies')

const max = Number.parseInt(
  env.OPENCODE_AI_FETCH_LOG_MAX_BYTES || '5242880',
  10,
)
const preview = Number.parseInt(
  env.OPENCODE_AI_FETCH_LOG_PREVIEW_CHARS || '512',
  10,
)
const tail = Number.parseInt(env.OPENCODE_AI_FETCH_LOG_TAIL_CHARS || '8192', 10)
const chunkLog = env.OPENCODE_AI_FETCH_LOG_CHUNKS !== '0'
const sseLog = env.OPENCODE_AI_FETCH_LOG_SSE !== '0'
const retries = Math.min(
  3,
  Math.max(1, Number.parseInt(env.OPENCODE_AI_FETCH_RETRY_ATTEMPTS || '2', 10)),
)
const retryMin = Math.max(
  0,
  Number.parseInt(env.OPENCODE_AI_FETCH_RETRY_MIN_MS || '250', 10),
)
const retryMax = Math.max(
  retryMin,
  Number.parseInt(env.OPENCODE_AI_FETCH_RETRY_MAX_MS || '750', 10),
)
const continuation = env.OPENCODE_AI_FETCH_CONTINUE_ON_RETRY !== '0'
const continuationTTL = Math.max(
  10_000,
  Number.parseInt(env.OPENCODE_AI_FETCH_CONTINUE_TTL_MS || '120000', 10),
)

const include = (env.OPENCODE_AI_FETCH_LOG_INCLUDE || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)

const exclude = (env.OPENCODE_AI_FETCH_LOG_EXCLUDE || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)

const markers = ['"tool-call"', '"tool_result"', '"toolCallId"']
const continuationNote =
  'Continue exactly from where you left off. Do not repeat text already written. Continue with the next sentence.'

const headers = (h) => Object.fromEntries(h.entries())
const clip = (text, size) => (text.length > size ? text.slice(0, size) : text)

const parseSSE = (raw) => {
  const lines = raw.split('\n')
  const event = lines
    .filter((x) => x.startsWith('event:'))
    .map((x) => x.slice(6).trim())
    .at(-1)
  const data = lines.filter((x) => x.startsWith('data:')).map((x) => x.slice(5))
  if (data.length === 0) return { event: event || null, data: null }
  return { event: event || null, data: data.join('\n').replace(/^\s/, '') }
}

const error = (cause) => {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
      cause: error(cause.cause),
    }
  }
  if (cause && typeof cause === 'object') return { ...cause }
  if (cause === undefined) return {}
  return { value: cause }
}

const match = (url) => {
  if (!url) return false
  if (exclude.some((x) => url.includes(x))) return false
  if (include.length === 0) return true
  return include.some((x) => url.includes(x))
}

const hash = (text) => createHash('sha1').update(text).digest('hex')

const requestKey = (url, method, body) => hash(`${method}:${url}:${body || ''}`)

const continuationState = (() => {
  const map = new Map()
  return {
    set(key, value) {
      map.set(key, { ...value, ts: Date.now(), applied: false })
    },
    get(key) {
      const item = map.get(key)
      if (!item) return null
      if (Date.now() - item.ts > continuationTTL) {
        map.delete(key)
        return null
      }
      return item
    },
    markApplied(key) {
      const item = map.get(key)
      if (!item) return
      item.applied = true
      item.ts = Date.now()
      map.set(key, item)
    },
  }
})()

const ensure = (() => {
  return () =>
    Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(bodies, { recursive: true }),
    ]).then(() => undefined)
})()

const event = async (line) => {
  if (!logToFile) return
  await ensure()
  await appendFile(events, `${JSON.stringify(line)}\n`)
}

const dropped = async (id, frames) => {
  if (!logToFile) return null
  if (!frames || frames.length === 0) return null
  await ensure()
  const file = path.join(bodies, `${id}.dropped.ndjson`)
  await appendFile(file, frames.map((x) => `${JSON.stringify(x)}\n`).join(''))
  return file
}

const sleep = async (ms, signal) => {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const delay = () =>
  retryMin + Math.floor(Math.random() * Math.max(1, retryMax - retryMin + 1))

const body = async (id, response) => {
  if (!response.body) {
    return {
      file: null,
      bytes: 0,
      truncated: false,
      text_file: null,
      chunk_file: null,
      chunks: 0,
      tail_utf8: '',
      sse_errors: [],
      partial_text: '',
      saw_thinking: false,
      saw_tool: false,
      empty_error: false,
      capture_error: null,
      capture_timeout: false,
      capture_aborted: false,
    }
  }

  if (logToFile) await ensure()
  const type = response.headers.get('content-type') || ''
  const file = logToFile ? path.join(bodies, `${id}.bin`) : null
  const chunkFile = logToFile && chunkLog ? path.join(bodies, `${id}.chunks.ndjson`) : null
  const textFile =
    logToFile && (/^text\//.test(type) ||
    type.includes('json') ||
    type.includes('event-stream'))
      ? path.join(bodies, `${id}.txt`)
      : null

  let out = null
  let txt = null
  let chunk = null
  let reader = null
  const decoder = new TextDecoder()

  let bytes = 0
  let truncated = false
  let count = 0
  let frame = 0
  let pending = ''
  let tailText = ''
  const sseErrors = []
  let partialText = ''
  let sawThinking = false
  let sawTool = false
  let emptyError = false
  let captureError = null

  const inspect = async (value, size) => {
    if (!value) return
    tailText = (tailText + value).slice(-tail)
    if (txt) await txt.write(value)
    if (chunk) {
      await chunk.write(
        `${JSON.stringify({
          type: 'chunk',
          index: count,
          bytes: size,
          preview: clip(value, preview),
          preview_truncated: value.length > preview,
        })}\n`,
      )
    }
    if (!type.includes('event-stream') || !sseLog) return

    pending += value.replace(/\r\n/g, '\n')
    for (;;) {
      const i = pending.indexOf('\n\n')
      if (i === -1) break
      const raw = pending.slice(0, i)
      pending = pending.slice(i + 2)
      if (!raw) continue

      const parsed = parseSSE(raw)
      if (chunk) {
        await chunk.write(
          `${JSON.stringify({
            type: 'sse',
            index: frame,
            event: parsed.event,
            data_preview:
              parsed.data === null ? null : clip(parsed.data, preview),
            data_truncated:
              typeof parsed.data === 'string' && parsed.data.length > preview,
          })}\n`,
        )
      }

      if (parsed.event === 'error' || parsed.data === '') {
        if (parsed.event === 'error' && (parsed.data || '').trim() === '')
          emptyError = true
        sseErrors.push({
          index: frame,
          event: parsed.event,
          data: parsed.data,
          raw: clip(raw, tail),
          raw_truncated: raw.length > tail,
        })
        if (sseErrors.length > 5) sseErrors.shift()
      }

      if (typeof parsed.data === 'string' && parsed.data.trim()) {
        try {
          const data = JSON.parse(parsed.data)
          if (data?.type === 'content_block_start') {
            const kind = data?.content_block?.type
            if (kind === 'thinking' || kind === 'redacted_thinking')
              sawThinking = true
            if (kind === 'tool_use') sawTool = true
          }
          if (data?.type === 'content_block_delta') {
            const kind = data?.delta?.type
            if (kind === 'thinking_delta' || kind === 'signature_delta')
              sawThinking = true
            if (
              kind === 'text_delta' &&
              typeof data?.delta?.text === 'string'
            ) {
              partialText += data.delta.text
            }
          }
          if (data?.type === 'tool_use' || data?.type === 'tool_result')
            sawTool = true
        } catch {}
      }
      frame += 1
    }
  }

  try {
    out = file ? await open(file, 'w') : null
    txt = textFile ? await open(textFile, 'w') : null
    chunk = chunkFile ? await open(chunkFile, 'w') : null
    reader = response.body.getReader()

    for (;;) {
      const read = await reader.read()
      if (read.done) break
      if (!read.value) continue

      if (bytes >= max) {
        truncated = true
        await reader.cancel('truncated')
        break
      }

      const size = Math.min(read.value.byteLength, max - bytes)
      if (size > 0) {
        const part =
          size === read.value.byteLength
            ? read.value
            : read.value.subarray(0, size)
        if (out) await out.write(part)
        await inspect(decoder.decode(part, { stream: true }), part.byteLength)
        bytes += part.byteLength
      }

      if (size < read.value.byteLength) {
        truncated = true
        await reader.cancel('truncated')
        break
      }

      count += 1
    }

    await inspect(decoder.decode(), 0)
    if (type.includes('event-stream') && pending.trim()) {
      sseErrors.push({
        index: frame,
        event: null,
        data: null,
        raw: clip(pending, tail),
        raw_truncated: pending.length > tail,
      })
      if (sseErrors.length > 5) sseErrors.shift()
    }
  } catch (e) {
    captureError = error(e)
  } finally {
    if (txt) {
      await txt.close().catch(() => undefined)
    }
    if (chunk) {
      await chunk.close().catch(() => undefined)
    }
    if (out) {
      await out.close().catch(() => undefined)
    }
  }

  return {
    file,
    bytes,
    truncated,
    text_file: textFile,
    chunk_file: chunkFile,
    chunks: count,
    tail_utf8: tailText,
    sse_errors: sseErrors,
    partial_text: partialText,
    saw_thinking: sawThinking,
    saw_tool: sawTool,
    empty_error: emptyError,
    capture_error: captureError,
    capture_timeout: captureError?.name === 'TimeoutError',
    capture_aborted: captureError?.name === 'AbortError',
  }
}

const reqMeta = (req) => ({
  url: req.url,
  method: req.method,
  headers: headers(req.headers),
})

const sseGuard = async (response) => {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('text/event-stream') || !response.body) {
    return {
      response,
      retryable: false,
      retry_reason: null,
      committed: false,
      seen_tool_marker: false,
      empty_error_action: 'none',
      suppressed_empty_error_count: 0,
      non_json_error_action: 'none',
      suppressed_non_json_error_count: 0,
      dropped_error_count: 0,
      dropped_error_frames: [],
      sanitized_empty_error: false,
      sanitized_frame_count: 0,
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  let pending = ''
  let pre = ''
  let committed = false
  let seenTool = false
  let retryReason = null
  let done = false
  let emptyAction = 'none'
  let suppressedEmpty = 0
  let nonJSONAction = 'none'
  let suppressedNonJSON = 0
  const droppedFrames = []
  let sanitizeCount = 0
  let sanitizeFlag = false

  const encode = (text) => encoder.encode(text)
  const hasTool = (text) => markers.some((x) => text.includes(x))

  const markDropped = (reason, parsed, raw) => {
    droppedFrames.push({
      ts: new Date().toISOString(),
      reason,
      event: parsed.event,
      data:
        typeof parsed.data === 'string'
          ? clip(parsed.data, preview * 4)
          : parsed.data,
      data_truncated:
        typeof parsed.data === 'string' && parsed.data.length > preview * 4,
      raw: clip(raw, tail),
      raw_truncated: raw.length > tail,
      committed,
      seen_tool_marker: seenTool,
    })
    if (droppedFrames.length > 30) droppedFrames.shift()
  }

  const map = (raw) => {
    const parsed = parseSSE(raw)
    const data = typeof parsed.data === 'string' ? parsed.data : ''
    if (hasTool(raw) || hasTool(data)) seenTool = true
    const isError = parsed.event === 'error'
    const emptyErr = isError && data.trim() === ''
    const nonJSONErr =
      isError &&
      data.trim() !== '' &&
      (() => {
        try {
          JSON.parse(data)
          return false
        } catch {
          return true
        }
      })()

    if (emptyErr && !committed) {
      retryReason = 'empty_error_pre_commit'
      emptyAction = seenTool ? 'retry_pre_commit_tool' : 'retry_pre_commit'
      markDropped('empty_error_pre_commit', parsed, raw)
      return null
    }

    if (nonJSONErr && !committed) {
      retryReason = 'non_json_error_pre_commit'
      nonJSONAction = seenTool ? 'retry_pre_commit_tool' : 'retry_pre_commit'
      markDropped('non_json_error_pre_commit', parsed, raw)
      return null
    }

    if (emptyErr) {
      suppressedEmpty += 1
      emptyAction = seenTool
        ? 'suppress_post_commit_tool'
        : 'suppress_post_commit'
      markDropped('empty_error_post_commit', parsed, raw)
      return null
    }

    if (nonJSONErr) {
      suppressedNonJSON += 1
      nonJSONAction = seenTool
        ? 'suppress_post_commit_tool'
        : 'suppress_post_commit'
      markDropped('non_json_error_post_commit', parsed, raw)
      return null
    }

    if (data.trim() !== '') committed = true
    return raw
  }

  const feed = () => {
    const out = []
    for (;;) {
      const i = pending.indexOf('\n\n')
      if (i === -1) break
      const raw = pending.slice(0, i)
      pending = pending.slice(i + 2)
      const mapped = map(raw)
      if (mapped !== null) out.push(`${mapped}\n\n`)
      if (retryReason) break
    }
    return out.join('')
  }

  while (!committed && !retryReason && !done) {
    const read = await reader.read()
    if (read.done) {
      done = true
      pending += decoder.decode()
      pre += feed()
      break
    }
    pending += decoder
      .decode(read.value, { stream: true })
      .replace(/\r\n/g, '\n')
    pre += feed()
  }

  if (retryReason && !committed) {
    await reader.cancel('retry')
    return {
      response: null,
      retryable: true,
      retry_reason: retryReason,
      committed,
      seen_tool_marker: seenTool,
      empty_error_action: emptyAction,
      suppressed_empty_error_count: suppressedEmpty,
      non_json_error_action: nonJSONAction,
      suppressed_non_json_error_count: suppressedNonJSON,
      dropped_error_count: droppedFrames.length,
      dropped_error_frames: droppedFrames,
      sanitized_empty_error: false,
      sanitized_frame_count: 0,
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      if (pre) controller.enqueue(encode(pre))
      void (async () => {
        try {
          while (true) {
            const read = await reader.read()
            if (read.done) {
              pending += decoder.decode()
              const out = feed()
              if (out) controller.enqueue(encode(out))
              if (pending) controller.enqueue(encode(pending))
              controller.close()
              break
            }
            pending += decoder
              .decode(read.value, { stream: true })
              .replace(/\r\n/g, '\n')
            const out = feed()
            if (out) controller.enqueue(encode(out))
          }
        } catch (e) {
          controller.error(e)
        }
      })()
    },
  })

  return {
    response: new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    retryable: false,
    retry_reason: null,
    committed,
    seen_tool_marker: seenTool,
    empty_error_action: emptyAction,
    suppressed_empty_error_count: suppressedEmpty,
    non_json_error_action: nonJSONAction,
    suppressed_non_json_error_count: suppressedNonJSON,
    dropped_error_count: droppedFrames.length,
    dropped_error_frames: droppedFrames,
    sanitized_empty_error: sanitizeFlag,
    sanitized_frame_count: sanitizeCount,
  }
}

const execute = async (original, request, signal, logID, info) => {
  let last
  const droppedFrames = []
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const response = await original(request.clone())
    const guarded = await sseGuard(response)

    if (guarded.dropped_error_frames?.length) {
      droppedFrames.push(
        ...guarded.dropped_error_frames.map((x) => ({ ...x, attempt })),
      )
      if (droppedFrames.length > 60) {
        droppedFrames.splice(0, droppedFrames.length - 60)
      }
    }

    if (!guarded.retryable) {
      return {
        response: guarded.response,
        attempt,
        max_attempts: retries,
        retry_decision: attempt > 1 ? 'retried_then_success' : 'none',
        retry_reason: null,
        retry_delay_ms: 0,
        retry_suppressed_reason: guarded.committed
          ? 'post_commit_stream'
          : null,
        empty_error_action: guarded.empty_error_action,
        suppressed_empty_error_count: guarded.suppressed_empty_error_count,
        non_json_error_action: guarded.non_json_error_action,
        suppressed_non_json_error_count:
          guarded.suppressed_non_json_error_count,
        dropped_error_count: droppedFrames.length,
        dropped_error_frames: droppedFrames,
        sanitized_empty_error: guarded.sanitized_empty_error,
        sanitized_frame_count: guarded.sanitized_frame_count,
      }
    }

    const canRetry = attempt < retries
    const ms = canRetry ? delay() : 0
    await event({
      type: 'retry_decision',
      id: logID,
      ts: new Date().toISOString(),
      request: info,
      attempt,
      max_attempts: retries,
      retry_decision: canRetry ? 'retry' : 'retry_exhausted',
      retry_reason: guarded.retry_reason,
      retry_delay_ms: ms,
      retry_suppressed_reason: null,
      empty_error_action: guarded.empty_error_action,
      suppressed_empty_error_count: guarded.suppressed_empty_error_count,
      non_json_error_action: guarded.non_json_error_action,
      suppressed_non_json_error_count: guarded.suppressed_non_json_error_count,
      dropped_error_count: guarded.dropped_error_count,
      dropped_error_frames: guarded.dropped_error_frames,
    })

    if (!canRetry) {
      return {
        response,
        attempt,
        max_attempts: retries,
        retry_decision: 'retry_exhausted',
        retry_reason: guarded.retry_reason,
        retry_delay_ms: 0,
        retry_suppressed_reason: null,
        empty_error_action: guarded.empty_error_action,
        suppressed_empty_error_count: guarded.suppressed_empty_error_count,
        non_json_error_action: guarded.non_json_error_action,
        suppressed_non_json_error_count:
          guarded.suppressed_non_json_error_count,
        dropped_error_count: droppedFrames.length,
        dropped_error_frames: droppedFrames,
        sanitized_empty_error: false,
        sanitized_frame_count: 0,
      }
    }

    await sleep(ms, signal)
    last = guarded.retry_reason
  }
  throw new Error(last || 'retry_failed')
}

export default function RawFetchLoggerPlugin() {
  if (globalThis.__opencode_raw_fetch_logger__?.installed) return {}

  const original = globalThis.fetch.bind(globalThis)
  globalThis.__opencode_raw_fetch_logger__ = { installed: true, original }

  globalThis.fetch = async (input, init) => {
    const id = crypto.randomUUID()
    const start = Date.now()
    const req = new Request(input, init)
    const info = reqMeta(req)
    let reqBodyText = ''
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reqBodyText = await req
        .clone()
        .text()
        .catch(() => '')
    }
    const key = requestKey(info.url, info.method, reqBodyText)
    if (!match(info.url)) return original(input, init)

    let runReq = req
    if (
      continuation &&
      info.method === 'POST' &&
      info.url.includes('/messages') &&
      reqBodyText
    ) {
      const saved = continuationState.get(key)
      if (
        saved &&
        !saved.applied &&
        saved.partial &&
        !saved.saw_thinking &&
        !saved.saw_tool
      ) {
        try {
          const bodyObj = JSON.parse(reqBodyText)
          if (!bodyObj?.thinking && Array.isArray(bodyObj?.messages)) {
            bodyObj.messages.push(
              { role: 'assistant', content: saved.partial },
              { role: 'user', content: continuationNote },
            )
            runReq = new Request(req, { body: JSON.stringify(bodyObj) })
            continuationState.markApplied(key)
            void event({
              type: 'continuation_applied',
              id,
              ts: new Date().toISOString(),
              request: info,
              continuation_key: key,
            })
          }
        } catch {}
      }
    }

    try {
      const run = await execute(original, runReq, init?.signal, id, info)
      const droppedFile = await dropped(id, run.dropped_error_frames).catch(
        () => null,
      )
      const clone = run.response.clone()
      void body(id, clone)
        .then(async (capture) => {
          await event({
            type: 'response',
            id,
            ts: new Date().toISOString(),
            duration_ms: Date.now() - start,
            attempt: run.attempt,
            max_attempts: run.max_attempts,
            retry_decision: run.retry_decision,
            retry_reason: run.retry_reason,
            retry_delay_ms: run.retry_delay_ms,
            retry_suppressed_reason: run.retry_suppressed_reason,
            empty_error_action: run.empty_error_action,
            suppressed_empty_error_count: run.suppressed_empty_error_count,
            non_json_error_action: run.non_json_error_action,
            suppressed_non_json_error_count:
              run.suppressed_non_json_error_count,
            dropped_error_count: run.dropped_error_count,
            dropped_error_file: droppedFile,
            dropped_error_frames: run.dropped_error_frames,
            sanitized_empty_error: run.sanitized_empty_error,
            sanitized_frame_count: run.sanitized_frame_count,
            request: info,
            response: {
              url: run.response.url,
              status: run.response.status,
              status_text: run.response.statusText,
              ok: run.response.ok,
              redirected: run.response.redirected,
              headers: headers(run.response.headers),
              body_file: capture.file,
              body_bytes: capture.bytes,
              body_truncated: capture.truncated,
              body_text_file: capture.text_file,
              body_chunk_file: capture.chunk_file,
              body_chunks: capture.chunks,
              body_tail_utf8: capture.tail_utf8,
              sse_errors: capture.sse_errors,
              capture_error: capture.capture_error,
              capture_timeout: capture.capture_timeout,
              capture_aborted: capture.capture_aborted,
            },
          })

          if (capture.capture_error) {
            await event({
              type: 'capture_warning',
              id,
              ts: new Date().toISOString(),
              stage: 'response_body_capture',
              request: info,
              attempt: run.attempt,
              max_attempts: run.max_attempts,
              retry_decision: run.retry_decision,
              retry_suppressed_reason: run.retry_suppressed_reason,
              capture_timeout: capture.capture_timeout,
              capture_aborted: capture.capture_aborted,
              error: capture.capture_error,
              response: {
                body_file: capture.file,
                body_bytes: capture.bytes,
                body_truncated: capture.truncated,
              },
            })
          }

          if (!continuation) return
          if (!capture.empty_error) return
          if (!capture.partial_text?.trim()) return
          continuationState.set(key, {
            partial: capture.partial_text,
            saw_thinking: capture.saw_thinking,
            saw_tool: capture.saw_tool,
          })
          await event({
            type: 'continuation_candidate',
            id,
            ts: new Date().toISOString(),
            request: info,
            continuation_key: key,
            partial_chars: capture.partial_text.length,
            saw_thinking: capture.saw_thinking,
            saw_tool: capture.saw_tool,
          })
        })
        .catch((e) =>
          event({
            type: 'logger_error',
            id,
            ts: new Date().toISOString(),
            stage: 'response_body_capture',
            request: info,
            error: error(e),
          }),
        )

      return run.response
    } catch (e) {
      await event({
        type: 'fetch_error',
        id,
        ts: new Date().toISOString(),
        duration_ms: Date.now() - start,
        attempt: 1,
        max_attempts: retries,
        request: info,
        aborted: !!init?.signal?.aborted,
        error: error(e),
      })
      throw e
    }
  }

  return {}
}
