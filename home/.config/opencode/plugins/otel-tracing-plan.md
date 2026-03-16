# OpenCode OTel Session Tracing Plugin — Implementation Plan

## 1. Span Hierarchy

```
Trace (deterministic ID from session.id)
│
├── SESSION span (root, name: "session")
│   ├── attr: session.id, project.id
│   ├── starts: session.created event
│   ├── ends:   session.idle event (or session.error)
│   │
│   ├── USER_MESSAGE span (name: "user-message")
│   │   ├── attr: message.id, agent, model, provider, prompt_length
│   │   ├── starts: chat.message hook fires
│   │   ├── ends:   session.status → idle (or next user message begins)
│   │   │
│   │   ├── ASSISTANT_MESSAGE span (name: "assistant-message")
│   │   │   ├── attr: message.id, parent_message.id, model.id, provider.id, cost, tokens.*
│   │   │   ├── starts: message.updated event (role: "assistant", parentID matches)
│   │   │   ├── ends:   message.updated event with completed time or error set
│   │   │   │
│   │   │   ├── LLM_STEP span (name: "llm-step")
│   │   │   │   ├── attr: step_index, snapshot_id
│   │   │   │   ├── starts: message.part.updated → step-start
│   │   │   │   ├── ends:   message.part.updated → step-finish (with cost, tokens, reason)
│   │   │   │   │
│   │   │   │   ├── TOOL_CALL span (name: "tool:{tool_name}")
│   │   │   │   │   ├── attr: tool, call_id, input (JSON), output, title, status
│   │   │   │   │   ├── starts: tool.execute.before hook
│   │   │   │   │   ├── ends:   tool.execute.after hook
│   │   │   │   │   └── error status if ToolStateError
│   │   │   │   │
│   │   │   │   └── ... more TOOL_CALL spans
│   │   │   │
│   │   │   └── ... more LLM_STEP spans (multi-step loops)
│   │   │
│   │   └── ... (queued messages may produce additional ASSISTANT_MESSAGE children)
│   │
│   └── ... more USER_MESSAGE spans
```

### Why this hierarchy

- **Session = Trace**: A single trace ID per session. All spans in the session share this trace. This makes it trivial to search "show me everything that happened in session X."
- **User message → assistant message → steps → tools**: Mirrors the actual execution model. Each level adds detail.
- **Queued messages**: When a user sends a message while the model is busy, `chat.message` fires during an active stream. The queued message gets its own USER_MESSAGE span as a child of SESSION (not nested under the previous user message).

## 2. State Management

### 2.1 Core State Maps

```typescript
// --- Span tracking ---
type SessionState = {
  sessionSpan: Span
  sessionCtx: Context              // context with session span active
  status: "idle" | "busy"
  currentUserMessageID: string | null
}

type UserMessageState = {
  span: Span
  ctx: Context                     // context with user message span active
  userMessageID: string
  isQueued: boolean                // true if chat.message fired while session was busy
}

type AssistantMessageState = {
  span: Span
  ctx: Context
  assistantMessageID: string
  parentUserMessageID: string
  stepCount: number
}

type StepState = {
  span: Span
  ctx: Context
  stepIndex: number
  partID: string                   // step-start part ID, used to correlate step-finish
}

type ToolCallState = {
  span: Span
  startTime: number
}

// --- Primary maps ---
const sessions        = new Map<string, SessionState>()          // sessionID → state
const userMessages    = new Map<string, UserMessageState>()      // messageID → state
const assistantMsgs   = new Map<string, AssistantMessageState>() // messageID → state
const activeSteps     = new Map<string, StepState>()             // `${sessionID}:${messageID}` → state
const toolCalls       = new Map<string, ToolCallState>()         // callID → state

// --- Lookup helpers ---
const activeUserMsg   = new Map<string, string>()  // sessionID → current user messageID
const activeAssistant = new Map<string, string>()  // sessionID → current assistant messageID
```

### 2.2 Deterministic Trace ID

Derive a 16-byte trace ID from the session ID using a hash:

```typescript
import { createHash } from "node:crypto"

function sessionTraceID(sessionID: string): string {
  // SHA-256 the session ID, take first 16 bytes, encode as 32 hex chars
  return createHash("sha256").update(sessionID).digest("hex").slice(0, 32)
}
```

To create a root context with a specific trace ID, construct a `SpanContext` and wrap it:

```typescript
import { trace, context, ROOT_CONTEXT, SpanKind, TraceFlags } from "@opentelemetry/api"

function createSessionRootContext(sessionID: string): { ctx: Context; traceId: string } {
  const traceId = sessionTraceID(sessionID)
  // Create a "remote" span context so the SDK uses our trace ID
  // but generates its own span ID for the actual root span
  const remoteCtx = trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId: "0000000000000000", // placeholder — will be parent
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  })
  return { ctx: remoteCtx, traceId }
}
```

The session span is then started with this context as parent. The SDK will inherit the traceId but generate a real spanId. All child spans inherit the traceId automatically through context propagation.

## 3. Hook Implementation Approach

### 3.1 `config` hook — Enable AI SDK telemetry

```typescript
config: async (cfg) => {
  // Enable experimental.openTelemetry so the AI SDK emits its own spans
  // (ai.streamText, ai.streamText.doStream, ai.toolCall, etc.)
  if (cfg.experimental) {
    cfg.experimental.openTelemetry = true
  } else {
    (cfg as any).experimental = { openTelemetry: true }
  }
}
```

**Why**: OpenCode already supports `experimental.openTelemetry: true` in config. When enabled, the AI SDK's built-in telemetry fires spans like `ai.streamText`, `ai.streamText.doStream`, and `ai.toolCall`. These will automatically be children of whatever context is active during the LLM call. By setting this via the config hook, users don't need to manually configure it.

**Caveat**: Based on GitHub issue [#5245](https://github.com/anomalyco/opencode/pull/5245), `experimental.openTelemetry` requires the OTel SDK to be initialized in the same process first — which our plugin does at load time. The AI SDK spans will nest under the active step span if context propagation works correctly through OpenCode's async flow. If context doesn't propagate (likely, since OpenCode's Go runtime manages the event loop), the AI SDK spans may appear as orphan root spans within the same trace. This is acceptable — they still share the trace ID and can be correlated.

### 3.2 `chat.message` hook — User sends a message

```typescript
"chat.message": async (input, output) => {
  const { sessionID, agent, model, messageID } = input
  const session = sessions.get(sessionID)
  if (!session) return // session.created hasn't fired yet — shouldn't happen

  const isQueued = session.status === "busy"

  // End previous user message span if transitioning (non-queued case)
  // For queued messages, the previous user message span stays open
  // until idle arrives

  const userSpan = tracer.startSpan("user-message", {
    kind: SpanKind.INTERNAL,
    attributes: {
      "message.id": messageID ?? "unknown",
      "message.agent": agent ?? "unknown",
      "message.model": model ? `${model.providerID}/${model.modelID}` : "unknown",
      "message.model.provider_id": model?.providerID ?? "unknown",
      "message.model.model_id": model?.modelID ?? "unknown",
      "message.queued": isQueued,
      "message.prompt_length": output.parts.reduce(
        (acc, p) => (p.type === "text" ? acc + (p as any).text.length : acc),
        0,
      ),
    },
  }, session.sessionCtx) // parent = session span

  const userCtx = trace.setSpan(session.sessionCtx, userSpan)

  const state: UserMessageState = {
    span: userSpan,
    ctx: userCtx,
    userMessageID: messageID ?? `synthetic-${Date.now()}`,
    isQueued,
  }

  if (messageID) {
    userMessages.set(messageID, state)
    activeUserMsg.set(sessionID, messageID)
  }
}
```

**Timing issue**: `chat.message` fires BEFORE `session.status → busy`. So when the first message fires, `session.status` is still "idle". This is correct — the first message is never queued. For subsequent messages that fire while busy, the session state has already transitioned to busy from a prior `session.status` event. The queued detection is: `session.status === "busy"` at the time `chat.message` fires.

### 3.3 `event` hook — Central event dispatcher

```typescript
event: async ({ event }) => {
  switch (event.type) {
    case "session.created":
      handleSessionCreated(event)
      break
    case "session.status":
      handleSessionStatus(event)
      break
    case "session.idle":
      handleSessionIdle(event)
      break
    case "session.error":
      handleSessionError(event)
      break
    case "message.updated":
      handleMessageUpdated(event)
      break
    case "message.part.updated":
      handlePartUpdated(event)
      break
  }
}
```

#### `handleSessionCreated`

```
- Create root context with deterministic trace ID from session.id
- Start SESSION span as child of that context
- Store in sessions map with status: "idle"
```

#### `handleSessionStatus`

```
- On "busy": set session.status = "busy"
- On "idle": set session.status = "idle" (session.idle handler does span cleanup)
- On "retry": add event to current step/assistant span with retry details
```

#### `handleSessionIdle`

```
- End current tool spans (shouldn't be any, but defensive)
- End current step span
- End current assistant message span
- End current user message span
- Set session.status = "idle"
- Do NOT end the session span here (session persists across idle periods)
```

Wait — actually, session.idle fires after each turn completes. The session span should stay open. We only end the session span on `session.deleted` or plugin shutdown. But in practice, sessions can be very long-lived. Let's revise:

**Decision**: End the SESSION span when the *session goes idle* after being busy. A new interaction (next `chat.message`) creates a new session span. This gives us one trace per "conversation turn" rather than one per session.

**Actually, re-reading the requirements**: "Track each session as a single trace (shared trace ID)." So the session span should stay open across multiple turns within the same session. We end it on:
1. `session.deleted` event
2. Plugin shutdown (flush + end)
3. A timeout (optional: no activity for N minutes)

For a practical local plugin, we'll end the session span on plugin shutdown or session deletion. The span will be long-lived. This means we need to **flush spans incrementally** — `BatchSpanProcessor` handles this automatically.

**Revised**: Keep session span open. End user message spans when `session.status → idle`.

#### `handleMessageUpdated`

```
When role: "assistant":
  - Look up parentID → find the user message this assistant message belongs to
  - Start ASSISTANT_MESSAGE span as child of user message context
  - Store in assistantMsgs map

When role: "assistant" AND (time.completed is set OR error is set):
  - This is the final update for the assistant message
  - Record tokens, cost, finish reason, error as span attributes
  - End the ASSISTANT_MESSAGE span
```

**Note**: `message.updated` fires multiple times — once when created, and again when updated. We need to handle both:
- First time (no completed time): create the span
- Subsequent times (completed or error set): update attributes + end span

#### `handlePartUpdated`

```
When type: "step-start":
  - Find the assistant message for this messageID
  - Increment step count
  - Start LLM_STEP span as child of assistant message context
  - Store in activeSteps keyed by `${sessionID}:${messageID}`

When type: "step-finish":
  - Look up the active step for `${sessionID}:${messageID}`
  - Record cost, tokens, reason as attributes
  - End the LLM_STEP span
  - Remove from activeSteps

When type: "tool" with state.status === "running":
  - (Optional) Can be used as a fallback if tool.execute.before doesn't fire
  - See tool hooks below for primary approach

When type: "tool" with state.status === "completed" or "error":
  - (Optional) Fallback for tool.execute.after
```

### 3.4 `tool.execute.before` hook — Tool call starts

```typescript
"tool.execute.before": async (input, output) => {
  const { tool, sessionID, callID } = input
  const stepKey = findActiveStep(sessionID) // get current step for this session
  const step = activeSteps.get(stepKey)
  if (!step) return // no active step — shouldn't happen

  const toolSpan = tracer.startSpan(`tool:${tool}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "tool.name": tool,
      "tool.call_id": callID,
      "tool.input": safeJSON(output.args),
    },
  }, step.ctx) // parent = current LLM step

  toolCalls.set(callID, {
    span: toolSpan,
    startTime: Date.now(),
  })
}
```

### 3.5 `tool.execute.after` hook — Tool call ends

```typescript
"tool.execute.after": async (input, output) => {
  const { tool, sessionID, callID, args } = input
  const toolState = toolCalls.get(callID)
  if (!toolState) return

  toolState.span.setAttributes({
    "tool.title": output.title,
    "tool.output_length": output.output?.length ?? 0,
    "tool.output_preview": output.output?.slice(0, 500) ?? "",
    "tool.has_metadata": !!output.metadata,
  })
  toolState.span.setStatus({ code: SpanStatusCode.OK })
  toolState.span.end()
  toolCalls.delete(callID)
}
```

### 3.6 Missing hook: `chat.params` — Inject OTel context into LLM call

The `chat.params` hook receives `output.options` which is a `Record<string, any>`. This is forwarded to the AI SDK's call options. We can inject `experimental_telemetry` here:

```typescript
"chat.params": async (input, output) => {
  const { sessionID } = input
  output.options.experimental_telemetry = {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
    functionId: `opencode-session-${sessionID.slice(0, 8)}`,
    metadata: {
      sessionID,
      agent: input.agent,
    },
  }
}
```

**Important**: This is the mechanism to enable AI SDK's built-in OTel spans. Whether this actually works depends on whether OpenCode forwards `output.options.experimental_telemetry` to the AI SDK call. Based on the existing plugin patterns and `chat.params` type (`options: Record<string, any>`), this is the intended extension point.

## 4. Attribute Schema

### 4.1 Session Span

| Attribute | Type | Source |
|---|---|---|
| `session.id` | string | `session.created` event |
| `session.project_id` | string | `session.created` → info.projectID |
| `session.title` | string | `session.created` → info.title |
| `session.directory` | string | `session.created` → info.directory |
| `service.name` | string | "opencode" (resource attr) |
| `service.version` | string | plugin version (resource attr) |

### 4.2 User Message Span

| Attribute | Type | Source |
|---|---|---|
| `message.id` | string | chat.message input.messageID |
| `message.role` | string | "user" |
| `message.agent` | string | chat.message input.agent |
| `message.model` | string | `${providerID}/${modelID}` |
| `message.model.provider_id` | string | chat.message input.model.providerID |
| `message.model.model_id` | string | chat.message input.model.modelID |
| `message.queued` | boolean | whether session was busy at send time |
| `message.prompt_length` | number | sum of text part lengths |

### 4.3 Assistant Message Span

| Attribute | Type | Source |
|---|---|---|
| `message.id` | string | message.updated → info.id |
| `message.role` | string | "assistant" |
| `message.parent_id` | string | info.parentID |
| `message.model_id` | string | info.modelID |
| `message.provider_id` | string | info.providerID |
| `message.mode` | string | info.mode |
| `message.cost` | number | info.cost (set on completion) |
| `message.tokens.input` | number | info.tokens.input |
| `message.tokens.output` | number | info.tokens.output |
| `message.tokens.reasoning` | number | info.tokens.reasoning |
| `message.tokens.cache_read` | number | info.tokens.cache.read |
| `message.tokens.cache_write` | number | info.tokens.cache.write |
| `message.finish` | string | info.finish (e.g., "stop", "length") |
| `message.error` | string | JSON of info.error if present |

### 4.4 LLM Step Span

| Attribute | Type | Source |
|---|---|---|
| `step.index` | number | incrementing counter per assistant message |
| `step.part_id` | string | step-start part.id |
| `step.snapshot` | string | step-start part.snapshot (if present) |
| `step.reason` | string | step-finish part.reason |
| `step.cost` | number | step-finish part.cost |
| `step.tokens.input` | number | step-finish part.tokens.input |
| `step.tokens.output` | number | step-finish part.tokens.output |
| `step.tokens.reasoning` | number | step-finish part.tokens.reasoning |
| `step.tokens.cache_read` | number | step-finish part.tokens.cache.read |
| `step.tokens.cache_write` | number | step-finish part.tokens.cache.write |

### 4.5 Tool Call Span

| Attribute | Type | Source |
|---|---|---|
| `tool.name` | string | tool.execute.before input.tool |
| `tool.call_id` | string | input.callID |
| `tool.input` | string | JSON.stringify(args), truncated to 4KB |
| `tool.title` | string | tool.execute.after output.title |
| `tool.output_length` | number | output.output.length |
| `tool.output_preview` | string | first 500 chars of output |
| `tool.has_metadata` | boolean | !!output.metadata |
| `tool.duration_ms` | number | end - start (also captured by span timing) |
| `tool.status` | string | "ok" or "error" |
| `tool.error` | string | error message if tool errored |

## 5. Edge Cases and Their Handling

### 5.1 Queued Messages

**Scenario**: User sends message B while model is processing message A.

**Detection**: When `chat.message` fires, check `sessions.get(sessionID).status === "busy"`.

**Handling**: Create USER_MESSAGE span B as a sibling of USER_MESSAGE span A (both children of SESSION). Message B's processing happens after A completes, so its assistant message, steps, and tools will naturally nest under B's context once B becomes the active user message.

**The tricky part**: After message A's processing completes and before B's processing starts, there's a brief `session.status → idle` followed by `session.status → busy` (if the loop continues). Actually, for queued messages in OpenCode, the loop *doesn't* go idle between — it absorbs the queued message and continues. So:

- Message B's `chat.message` fires during A's processing (span B starts)
- A's processing completes (step-finish, etc.) 
- Loop picks up B, starts processing it (new step-start on B's assistant message)
- B's processing completes
- `session.status → idle`

At `session.status → idle`, we end *all* open user message spans for this session. This is cleaner than trying to track which message just finished.

### 5.2 Session Created Before Plugin Loads

If the plugin loads after a session already exists, `session.created` won't fire. When events arrive for an unknown session:

```typescript
function ensureSession(sessionID: string): SessionState {
  let state = sessions.get(sessionID)
  if (!state) {
    // Lazy initialization — session was created before plugin loaded
    const { ctx, traceId } = createSessionRootContext(sessionID)
    const sessionSpan = tracer.startSpan("session", {
      kind: SpanKind.INTERNAL,
      attributes: { "session.id": sessionID, "session.late_init": true },
    }, ctx)
    const sessionCtx = trace.setSpan(ctx, sessionSpan)
    state = { sessionSpan, sessionCtx, status: "idle", currentUserMessageID: null }
    sessions.set(sessionID, state)
  }
  return state
}
```

### 5.3 Tool Errors

When a tool fails, `tool.execute.after` still fires but with error information in the output. Alternatively, if the tool throws, it may not fire at all (the error propagates). Handle both:

```typescript
// In tool.execute.after:
if (output.metadata?.error) {
  toolState.span.setStatus({ code: SpanStatusCode.ERROR, message: String(output.metadata.error) })
  toolState.span.recordException(new Error(String(output.metadata.error)))
}

// Safety net: clean up orphaned tool spans on step-finish
function cleanupOrphanedTools(sessionID: string) {
  for (const [callID, state] of toolCalls) {
    // Tool spans should be ended by tool.execute.after
    // If still open at step-finish, force end with error
    state.span.setStatus({ code: SpanStatusCode.ERROR, message: "tool span not properly closed" })
    state.span.end()
    toolCalls.delete(callID)
  }
}
```

### 5.4 API Errors on Assistant Message

When the LLM call fails (rate limit, auth error, etc.), the `message.updated` event fires with an error field. The assistant message span should capture this:

```typescript
if (info.error) {
  assistantSpan.setStatus({
    code: SpanStatusCode.ERROR,
    message: `${info.error.name}: ${info.error.data?.message ?? "unknown"}`,
  })
  assistantSpan.recordException(new Error(JSON.stringify(info.error)))
}
```

### 5.5 Retries

`session.status` fires with `type: "retry"`. Record as an event on the current step span:

```typescript
case "retry": {
  const step = findActiveStepForSession(sessionID)
  if (step) {
    step.span.addEvent("retry", {
      "retry.attempt": status.attempt,
      "retry.message": status.message,
      "retry.next": status.next,
    })
  }
}
```

### 5.6 Aborted Sessions

If the user aborts (Ctrl+C or session switch), `session.status → idle` fires. All open spans should be ended. The shutdown handler also catches this.

### 5.7 Multiple Sessions

The plugin supports multiple concurrent sessions (e.g., in split-pane mode). All state is keyed by `sessionID`.

### 5.8 step-start Without Matching step-finish

If the LLM stream is interrupted, step-finish may never arrive. Clean up on `session.status → idle`:

```typescript
function endAllOpenSpans(sessionID: string) {
  // End active step
  for (const [key, step] of activeSteps) {
    if (key.startsWith(`${sessionID}:`)) {
      step.span.setStatus({ code: SpanStatusCode.ERROR, message: "step interrupted" })
      step.span.end()
      activeSteps.delete(key)
    }
  }
  // End active tool calls (session-scoped cleanup requires scanning)
  // ... similar pattern
}
```

### 5.9 Context Propagation Limitations

OpenCode runs the Go runtime and invokes plugin hooks via RPC. The active OTel context is NOT automatically propagated from one hook invocation to the next. We must manually maintain context through our state maps — this is why every span state includes its `ctx`. We never rely on `context.active()` being correct.

## 6. File Structure

### 6.1 Single-file plugin: `~/.config/opencode/plugins/otel-tracing.ts`

The plugin is a single file. All logic is self-contained. The OTel SDK is initialized at the top level (module scope), and the plugin function returns hooks that reference the shared tracer, state maps, and helper functions.

```
~/.config/opencode/
├── plugins/
│   └── otel-tracing.ts          ← The plugin (single file)
├── package.json                  ← Must include OTel dependencies
└── opencode.json                 ← Plugin registration
```

### 6.2 Dependencies in `~/.config/opencode/package.json`

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "1.2.26",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-trace-base": "^2.6.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.213.0",
    "@opentelemetry/resources": "^2.6.0",
    "@opentelemetry/semantic-conventions": "^1.30.0"
  }
}
```

**Why `sdk-trace-base` instead of `sdk-trace-node`?**
`sdk-trace-node` relies on Node.js-specific APIs for auto-instrumentation and context managers (e.g., `async_hooks`). Since this runs in Bun, we use `sdk-trace-base` which provides `BasicTracerProvider` and `BatchSpanProcessor` without Node.js-specific dependencies. Bun has `async_hooks` support, but we don't need auto-instrumentation — we manually create all spans.

**Why `exporter-trace-otlp-http` instead of `-grpc`?**
gRPC requires native bindings (`@grpc/grpc-js`) which can be problematic in Bun. HTTP/JSON export is simpler, more portable, and sufficient for local/cloud collector export.

### 6.3 Config registration in `opencode.json`

```json
{
  "plugin": [
    "./plugins/otel-tracing.ts"
  ]
}
```

### 6.4 Plugin File Skeleton

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  ROOT_CONTEXT,
  type Span,
  type Context,
} from "@opentelemetry/api"
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { Resource } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { createHash } from "node:crypto"

// --- OTel SDK setup (module scope, runs once) ---

const resource = new Resource({
  [ATTR_SERVICE_NAME]: "opencode",
  [ATTR_SERVICE_VERSION]: "0.1.0",
})

const exporter = new OTLPTraceExporter({
  // Reads OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  // OTEL_EXPORTER_OTLP_HEADERS from env automatically
})

const provider = new BasicTracerProvider({ resource })
provider.addSpanProcessor(new BatchSpanProcessor(exporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 30000,
}))
provider.register()

const tracer = trace.getTracer("opencode-otel-tracing", "0.1.0")

// --- Types ---
// (SessionState, UserMessageState, etc. as defined in section 2)

// --- State maps ---
// (as defined in section 2)

// --- Helper functions ---
// sessionTraceID(), createSessionRootContext(), ensureSession(),
// safeJSON(), findActiveStep(), endAllOpenSpans()

// --- Plugin export ---

export const OtelTracingPlugin: Plugin = async ({ project }) => {
  // ... return hooks object with:
  // config, chat.message, chat.params, event,
  // tool.execute.before, tool.execute.after
}

export default OtelTracingPlugin
```

## 7. OTel SDK Initialization Details

### 7.1 Provider Setup

Use `BasicTracerProvider` (not `NodeTracerProvider`) for Bun compatibility. The provider is created at module load time — before any hooks fire. This ensures the OTel SDK is ready when OpenCode calls our plugin function.

### 7.2 Exporter Configuration

The `OTLPTraceExporter` automatically reads standard env vars:
- `OTEL_EXPORTER_OTLP_ENDPOINT` — base endpoint (default: `http://localhost:4318`)
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` — traces-specific override
- `OTEL_EXPORTER_OTLP_HEADERS` — auth headers

No custom configuration needed in code.

### 7.3 Shutdown

Register handlers for graceful shutdown:

```typescript
async function shutdown() {
  // End all open spans
  for (const [, state] of sessions) {
    state.sessionSpan.end()
  }
  // Flush and shut down
  await provider.forceFlush()
  await provider.shutdown()
}

process.on("SIGTERM", () => shutdown())
process.on("SIGINT", () => shutdown())
process.on("beforeExit", () => shutdown())
```

## 8. Event Ordering and Race Conditions

### 8.1 Guaranteed Order

Based on the OpenCode source:

1. `chat.message` → synchronous, fires in `createUserMessage()`
2. `session.status → busy` → fires when `start()` acquires lock
3. `message.updated` (assistant, initial) → fires when assistant message created
4. `message.part.updated` (step-start) → fires when step begins
5. `message.part.updated` (tool parts) → fire during processing
6. `tool.execute.before` → fires before tool runs
7. `tool.execute.after` → fires after tool completes
8. `message.part.updated` (step-finish) → fires when step ends
9. Steps 4-8 may repeat for multi-step loops
10. `message.updated` (assistant, final) → fires with completion/error
11. `session.status → idle`
12. `session.idle`

### 8.2 Correlating Assistant Messages to User Messages

The assistant message has `parentID` pointing to the user message ID. We use this to find the correct user message span context.

### 8.3 Correlating Tool Calls to Steps

Tool calls happen between step-start and step-finish. Since we track `activeSteps` by `${sessionID}:${messageID}`, and tool.execute.before gives us `sessionID`, we can find the active step by scanning for a step whose key starts with `${sessionID}:`. In practice, there's only one active step per session at a time.

### 8.4 Correlating Step Parts to Assistant Messages

Step-start and step-finish parts include `messageID`. We look up the assistant message by `messageID` to find the parent context.

## 9. Testing Strategy

### 9.1 InMemorySpanExporter

For testing, swap the OTLP exporter with `InMemorySpanExporter` from `@opentelemetry/sdk-trace-base`. Simulate the event sequence and verify:

- Correct parent-child relationships via `parentSpanId`
- All spans share the same `traceId`
- Attributes are set correctly
- Spans are ended with correct status codes

### 9.2 Manual Testing

1. Start a local OTel collector (Jaeger, Zipkin, or `otel-desktop-viewer`)
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
3. Use OpenCode, send messages, observe traces

## 10. Open Questions / Risks

1. **Does `chat.params` → `output.options.experimental_telemetry` actually propagate to the AI SDK?** This depends on OpenCode's implementation. If it doesn't, the AI SDK spans won't appear. The plugin still works without them — our manual spans cover the full hierarchy.

2. **Context propagation across hook invocations**: OpenCode calls hooks from Go via RPC. The Node.js/Bun async context may not be preserved between calls. Our design doesn't rely on it — we always pass explicit context from our state maps.

3. **Long-lived session spans**: A session that runs for hours produces a span with a very long duration. Some backends may not handle this well. Consider adding a configurable option to split traces by user message instead.

4. **Bun compatibility**: `@opentelemetry/sdk-trace-base` and `@opentelemetry/exporter-trace-otlp-http` use standard APIs (fetch, setTimeout). They should work in Bun. The main risk is `BatchSpanProcessor`'s use of `setTimeout` — Bun supports this. `createHash` from `node:crypto` is also supported.

5. **`messageID` in `tool.execute.before`/`tool.execute.after`**: Currently not provided (see [issue #15933](https://github.com/anomalyco/opencode/issues/15933)). We work around this by tracking the active step per session, which implicitly tells us which message the tool belongs to.

6. **Memory leaks**: Session state maps grow over time. Add cleanup: when a session is deleted or goes idle, schedule removal of its state after a delay (to allow final span export).
