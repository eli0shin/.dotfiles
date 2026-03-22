# pi otel tracing

Trace pi sessions, user messages, LLM turns, and tool executions over OTLP/HTTP.

This ports the same trace-first shape used in the local OpenCode tracing plugin:

- `session`
  - `user_message`
    - `llm_call`
      - `tool_call`

Queued follow-up prompts are modeled as `queued_user_message` spans and are parented to the in-flight user span.

## Files

- `index.ts` — pi extension entrypoint and event wiring
- `otel.ts` — OTLP runtime + config loading
- `state.ts` — span lifecycle/state machine
- `spans.ts` — attribute shaping and truncation helpers
- `otel.base.json` — default config merged to `otel.json` by `dot merge`

## Config

Configuration is read from the first available source:

1. `PI_OTEL_CONFIG=/absolute/path/to/file.json`
2. `otel.json`
3. `otel.base.json`

`otel.json` supports `{env:VAR_NAME}` interpolation.

Example:

```json
{
  "endpoint": "http://localhost:4318/v1/traces",
  "headers": {
    "Authorization": "Bearer {env:CLICKSTACK_OTEL_KEY}"
  },
  "serviceName": "pi",
  "serviceVersion": "0.1.0",
  "userId": "{env:USER}",
  "maxAttributeLength": 12000
}
```

## Setup

1. Install deps in this directory:
   ```bash
   cd ~/.pi/agent/extensions/otel-tracing
   npm install
   ```
2. Optionally customize `otel.personal.json`, `otel.work.json`, or `otel.local.json`.
   - By default this mirrors `~/.config/opencode/otel.json` for transport settings: endpoint `http://localhost:4320/v1/traces` and header `Authorization: {env:CLICKSTACK_OTEL_KEY}`.
   - Use `otel.local.json` only for machine-local overrides.
3. Run `dot merge` if you want a generated `otel.json` from layered config.
4. Start pi and trigger a prompt with at least one tool call.

## Verification

Look for spans with these names:

- `session`
- `user_message`
- `queued_user_message`
- `llm_call`
- `tool_call`

Useful attributes include:

- `session.id`
- `message.content`
- `llm.prompt.messages`
- `llm.prompt.system`
- `assistant.output.text`
- `tool.input`
- `tool.details`

## Notes

- Prompt and tool payload attributes are truncated with `maxAttributeLength`.
- Image payloads are replaced with `[image]` placeholders before serialization.
- Session spans stay open until pi shuts down or switches sessions.
- This version does not yet attach separate subagent pi processes under the originating tool span.
