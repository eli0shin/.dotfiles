# pi-claude-bridge vs OpenCode Claude Agent

## Scope and sources

Compared `elidickinson/pi-claude-bridge` main at `0b41f78189de09c6da6baf3acc0f604b089f08fb` with OpenCode dev at `296074aab29138dd94af7d82e70b3513e28746ea`. OpenCode's provider is built into core, despite its internal provider-plugin organization; it is not one of the separate community Claude Code plugins. It shipped in 2.2.3 after [PR #58782](https://github.com/anomalyco/opencode/pull/58782) merged.

Primary references:

- [Bridge README](https://github.com/elidickinson/pi-claude-bridge/blob/0b41f78189de09c6da6baf3acc0f604b089f08fb/README.md)
- [Bridge provider implementation](https://github.com/elidickinson/pi-claude-bridge/blob/0b41f78189de09c6da6baf3acc0f604b089f08fb/src/index.ts)
- [Bridge config](https://github.com/elidickinson/pi-claude-bridge/blob/0b41f78189de09c6da6baf3acc0f604b089f08fb/src/config.ts)
- [Bridge MCP server](https://github.com/elidickinson/pi-claude-bridge/blob/0b41f78189de09c6da6baf3acc0f604b089f08fb/src/mcp-server.ts)
- [OpenCode provider specification](https://github.com/anomalyco/opencode/blob/296074aab29138dd94af7d82e70b3513e28746ea/specs/v2/claude-agent-provider.md)
- [OpenCode user docs](https://github.com/anomalyco/opencode/blob/296074aab29138dd94af7d82e70b3513e28746ea/services/www/src/docs/content/claude-agent.mdx)
- [OpenCode query options](https://github.com/anomalyco/opencode/blob/296074aab29138dd94af7d82e70b3513e28746ea/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts)
- [OpenCode history decisions](https://github.com/anomalyco/opencode/blob/296074aab29138dd94af7d82e70b3513e28746ea/packages/core/src/plugin/provider/claude-agent/sync/decide.ts)
- [OpenCode catch-up conversion](https://github.com/anomalyco/opencode/blob/296074aab29138dd94af7d82e70b3513e28746ea/packages/core/src/plugin/provider/claude-agent/sync/catch-up.ts)

## Common functional model

Both use the Claude Agent SDK and a Claude Code subprocess as an inference backend. Both disable Claude Code's built-in tools and expose the host harness's tools over in-process MCP. Tool execution and the UI remain in Pi or OpenCode, respectively. Both use Claude Code's base system prompt plus forwarded host instructions, rather than simply replacing Claude Code's prompt with the host's default prompt. Both leave ordinary compaction to the host. These are provider integrations, not complete Claude Code interfaces. [Bridge README/provider; OpenCode spec/query options]

## Material differences

| Area | pi-claude-bridge | OpenCode Claude Agent |
| --- | --- | --- |
| Packaging | Pi extension, `pi install npm:pi-claude-bridge` | Built-in provider; connect Claude Agent |
| Executable | Supports an explicit path; otherwise SDK executable resolution | Requires the user's installed `claude`, on PATH or `OPENCODE_CLAUDE_PATH`; docs require 2.1.248+ |
| Process lifetime | Starts a fresh SDK query/subprocess per completed user turn, resuming saved CC history; keeps it alive across tool steps within that turn | Long-running process per session; stops after five idle minutes; restarts when prompt/tools/connection settings change |
| CC settings/hooks | Loads user settings (`settingSources: ["user"]`), including user hooks, but not project settings; excludes CC instruction files to avoid duplication | Does not load user/project CC settings, instruction files, hooks, skills or MCP servers |
| Memory/MCP escape hatches | Auto-memory off by default, configurable; filesystem MCP isolation on by default, configurable; claude.ai cloud MCP disabled | Memory and CC MCP configuration deliberately excluded |
| Model discovery | Pi-ai Anthropic catalog; explicit subscription-plan/long-context configuration and overrides | Models and context size reported by Claude Code; cached discovery; effort exposed as variants |
| Cross-provider history | Imports Pi's prior conversation into CC session records; model changes import history into a fresh session | Sends unseen history as catch-up content in a user message, excluding thinking, rather than importing it as native CC conversation turns |
| History edits | Content digests and safe record boundaries retain matching native history; forks or writes a retained prefix plus imported suffix | Fingerprints/checkpoints find matching native history; branches from safe boundaries and sends missed content as catch-up |
| Summarization | Isolated, tool-free one-off CC queries for Pi summary calls; live session untouched until history changes | Throwaway copy of live chat retaining its prompt/tools to reuse prompt cache |
| Prompt extensions | Structured project context, skills, custom prompts, appended instructions and sections forwarded; arbitrary replacement/wrapping routes have documented restrictions | Selected agent role and keyed host instructions forwarded; prompt changes restart CC |
| Quota visibility | Forwards CC rate-limit events as response headers for Pi extensions; no quota UI itself | Spec lists Claude subscription `/usage` and limit-management UI as unsupported |
| Extra delegation tool | Deprecated, opt-in AskClaude can delegate to CC while another provider drives Pi | No equivalent extra delegation tool supplied by this provider; normal OpenCode subagents remain available |

Sources: bridge README, provider, config; OpenCode spec, user docs, query options, sync decisions and catch-up conversion above.

## Integration caveats

The bridge's README explicitly says `before_agent_start -> systemPrompt` is dropped; structured prompt sections and other documented routes should be used instead. It also warns that some system-prompt changes may not take effect while Claude's existing prompt recording is retained. OpenCode explicitly restarts on prompt changes. This matters for heavily customized instruction-injection workflows. [Bridge README/provider; OpenCode spec]

The bridge uses Claude Code's `claudecode/toolUseId` MCP metadata to pair tool calls and results; its source calls this a CC-specific extension. OpenCode instead captures IDs with its own pre-tool hook and deliberately does not advertise parallel-safe MCP tools because it remembers one active ID at a time. This is an implementation constraint, not a measured end-to-end speed comparison. [Bridge MCP server; OpenCode spec]

OpenCode documents that ordinary HTTP request/response plugin hooks cannot intercept these API calls, and sampling knobs such as temperature/top-p/seed are unsupported. Its own tools, permission UI, Plan agent, compaction and subagents still apply. [OpenCode user docs/spec]

Both integrations use Claude Code rather than taking over direct Anthropic requests. That architectural fact alone is not a guarantee about Anthropic authorization, subscription eligibility, future billing, or relative quota efficiency. No runtime, speed, coding-quality, or quota benchmark was performed.

## Bottom line

The main capability is substantially the same: Claude Code inference inside another harness, using that harness's tools. OpenCode is more isolated from the user's Claude Code configuration and has a persistent-process/cache-aware compaction design. The bridge offers more CC-user-configuration compatibility and imports cross-provider history as structured CC records, but has more explicit Pi prompt-extension compatibility constraints. Choosing between them is principally choosing the host harness and its extension ecosystem, not choosing between fundamentally different Claude capabilities.

## Freshness warning

The web-indexed bridge README and provider source initially returned an older history-sync implementation. The current GitHub API versions already preserve matching prefixes and fork after history edits. Do not repeat the older claim that every abort/tree edit necessarily rebuilds the entire conversation. Claims above use the pinned current revision.
