# OpenCode OTel tracing

This plugin lives at `plugins/otel-tracing.ts` and is auto-discovered from `~/.config/opencode/plugins/` by OpenCode's local plugin loader.

## Setup

1. Install dependencies in `~/.config/opencode/` with `bun install`.
2. Configure tracing export in `home/.config/opencode/otel.base.json`, with optional overrides in `home/.config/opencode/otel.personal.json`, `home/.config/opencode/otel.work.json`, or `home/.config/opencode/otel.local.json` for machine-local secrets.
3. `otel.json` supports the same `{env:SOME_ENV_VAR}` interpolation style used by OpenCode config, so secrets like ingest tokens can stay out of git.
4. For ClickStack local, put the ingest token under `headers.Authorization`, for example `"Authorization": "{env:CLICKSTACK_INGEST_TOKEN}"` in `home/.config/opencode/otel.local.json`.
5. Run `dot merge` or `dot stow` so the generated `home/.config/opencode/otel.json` matches the active profile.

## Verify

1. Start Jaeger or another OTLP collector.
2. Confirm `home/.config/opencode/otel.json` points at the collector you want to use.
3. Export any referenced env vars before launching OpenCode, for example `export CLICKSTACK_INGEST_TOKEN=...`.
4. Run OpenCode and send a prompt that triggers at least one tool call.
5. Confirm traces contain `session`, `user_message`, `llm_call`, and `tool_call` spans.
6. Trigger a subagent and confirm the child session is nested under the originating `task` tool span.
7. Send a second message while the first is still busy and confirm the queued message is nested under the in-flight user span.
