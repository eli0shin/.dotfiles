# OpenCode V2 trim and Pi parity

## Scope

This note records the design facts for a native OpenCode V2 setup that:

- exposes only the `build` primary agent;
- prevents all subagent use;
- uses a small Pi-style build system prompt;
- ports the ordinary-session and orchestration behavior of `home/.pi/agent/extensions/pr-watch.ts`;
- adds an `orchestrate-opencode` Fish function.

The existing OpenCode V1 configuration is not a design input for this work.

## Agent configuration

OpenCode V2 ships four visible agents: primary `build` and `plan`, plus subagents `general` and `explore`. It also has hidden maintenance agents for compaction, titles, and summaries. A built-in visible agent can be removed with `disabled: true`. The build agent can also deny every child launch with a final `subagent` permission rule. Therefore the native V2 configuration can make `build` the only visible agent by:

1. setting `default_agent` to `build`;
2. disabling `plan`, `general`, and `explore`;
3. keeping `build` in `primary` mode;
4. denying `subagent` on `*` for `build`.

The hidden maintenance agents should remain because they are internal system agents, not selectable coding agents.

Sources:

- [OpenCode V2 agents](https://opencode.ai/v2/docs/agents)
- [OpenCode V2 permissions](https://opencode.ai/v2/docs/permissions)

## System prompt

A non-empty `agents.build.system` value replaces OpenCode's provider-specific base prompt for that agent. It does not replace discovered `AGENTS.md` files, built-in environment context, skills, references, MCP guidance, or session-specific instructions. This makes the agent system prompt the correct place for a small Pi-style identity and general behavior, while project and global rules stay in `AGENTS.md`.

Pi's installed default prompt starts with this identity:

> You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Its unconditional general guidelines are:

- Be concise in your responses.
- Show file paths clearly when working with files.

Pi then adds tool-dependent guidance, Pi documentation paths, context files, skills, and the current working directory. OpenCode V2 already supplies tools and instruction sources separately, so copying Pi-specific documentation and runtime paths would be incorrect. The smallest semantic match is the adapted identity plus the two unconditional guidelines.

Sources:

- [OpenCode V2 agent `system`](https://opencode.ai/v2/docs/agents#system)
- [OpenCode V2 instruction ordering](https://opencode.ai/v2/docs/instructions#ordering)
- Installed Pi prompt builder: `/home/linuxbrew/.linuxbrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js`
- Installed Pi overview: `/home/linuxbrew/.linuxbrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`

## Confirmed design decisions

The selected system prompt is the adapted Pi prompt: OpenCode identity, Pi's short coding-assistant description, and Pi's two unconditional guidelines. The implementation will use both the documented server plugin API and the current beta TUI plugin API so commands, footer status, and toasts can match Pi.

The OpenCode port must also retain the orchestration contract. For the first version, OpenCode is the parent orchestrator and existing Pi sessions remain the workers. OpenCode workers are out of scope. `orchestrate-opencode` will create one UUID and export it as both the OpenCode parent ID and `PI_ORCHESTRATION_SESSION_ID`, so the existing orchestrator skill and `spawn-worker` script can continue to launch Pi workers unchanged. The OpenCode parent will consume the existing Pi worker snapshot protocol and directory.

## PR-watch behavior to port

The Pi extension's ordinary-session contract is:

- start active for each session;
- enroll an open PR after relevant `gh pr` commands;
- enroll the current remote branch tip after `git push` when no PR exists;
- poll every 60 seconds;
- detect terminal CI, new feedback, and newly introduced merge conflicts;
- suppress general bot comments but retain bot reviews and inline review comments;
- distinguish author and reviewer safety behavior;
- buffer updates while the agent is busy, then wake it with one batched message when idle;
- keep `/pr-watch status|on|off|pause|resume|add|remove|reset`;
- persist watch state with the session and restore it when the session resumes;
- show watch state in the footer.

The extension also has a separate Pi orchestration contract. Worker sessions publish watched PR snapshots to a parent orchestration session through `PI_PARENT_ORCHESTRATION_SESSION_ID` and `PI_ORCHESTRATION_SESSION_ID`. The repository exposes this mode through `home/.config/fish/functions/orchestrate-pi.fish`. The OpenCode port must preserve worker membership union, concise worker PR notifications, current landing-branch SHA watching, startup recovery, and orchestration state persistence.

Source:

- `home/.pi/agent/extensions/pr-watch.ts`
- `home/.pi/agent/extensions/test/pr-watch.test.ts`
- `home/.config/fish/functions/orchestrate-pi.fish`

## OpenCode V2 plugin mapping

The documented V2 server plugin API provides the core mechanisms needed for the watcher:

- plugin cleanup for timers and other long-lived resources;
- tool before/after hooks to observe successful shell commands;
- the public event stream for session execution and idle events;
- `ctx.session.synthetic(...)` to admit durable synthetic input with `steer` or `queue` delivery and schedule agent execution;
- command transforms and session APIs.

A server plugin can therefore own polling, GitHub queries, per-session buffering, and synthetic wake-up messages. Because the server and TUI are separate processes, server-side plugin state must not depend on TUI process memory.

The documented server plugin API does not expose footer slots, toasts, or direct no-model slash-command handlers. The current official `@opencode-ai/plugin@next` package also exposes a separate TUI plugin API with durable storage, slash command registration, toasts, event access, and footer slots. That API can provide Pi-like command and status UX, but the V2 documentation does not yet document it and the V2 plugin API is explicitly still beta.

Sources:

- [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins)
- [OpenCode V2 synthetic session input](https://opencode.ai/v2/docs/api/session/v2-session-synthetic)
- [OpenCode V2 event stream](https://opencode.ai/v2/docs/api/event/v2-event-subscribe)
- [OpenCode V2 migration warning for plugins](https://opencode.ai/v2/docs/migrate-v1#plugins)
- Official package types from `@opencode-ai/plugin@next`, especially `dist/promise/session.d.ts`, `dist/promise/tool.d.ts`, and `dist/tui/context.d.ts`

## Shared-service feasibility probe

A throwaway integration probe used `opencode2 v0.0.0-next-17274` with an isolated home, config, state, data, and cache directory. It started the normal shared background service without an orchestration marker and loaded one server plugin plus one TUI plugin.

The probe established these facts:

1. The server plugin ran in the background service process and did not inherit a marker exported only for the TUI client.
2. The TUI plugin ran in the client process and did see that marker.
3. Both plugins received the same `session.created` event and session ID from the shared service.
4. The TUI plugin wrote a registration file keyed by that session ID.
5. When the TUI started with `--session <existing-id>`, its current route immediately exposed that session ID, and the plugin registered the resumed session with the client-only marker.

Therefore the normal shared service can support orchestration reliably. The boundary is explicit:

- `orchestrate-opencode` exports the orchestration ID to the TUI process;
- the TUI plugin associates that ID with the selected OpenCode session and writes an atomic registration file;
- the server plugin reads the registration and owns polling, persistence, and synthetic wake-ups;
- resumed sessions keep their persisted orchestration identity instead of accepting a fresh accidental replacement;
- no `--standalone` mode is required.

The probe was throwaway code under `/tmp/opencode2-shared-service-probe`; it did not modify the repository or the user's active OpenCode service.

## Configuration boundary

OpenCode V2 reads the global service configuration from `~/.config/opencode/opencode.json(c)`. Native V2 uses `agents`, `permissions`, and `plugins`. The global TUI uses `~/.config/opencode/cli.json`. V2 is a beta and its plugin contracts can change, so the implementation must pin compatible `@opencode-ai/*` package versions and verify both server and TUI plugin loading with the installed `opencode2` version.

Sources:

- [OpenCode V2 config](https://opencode.ai/v2/docs/config)
- [OpenCode V2 migration guide](https://opencode.ai/v2/docs/migrate-v1)
- [OpenCode V2 troubleshooting](https://opencode.ai/v2/docs/troubleshooting)
