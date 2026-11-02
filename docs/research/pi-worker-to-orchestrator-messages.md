# Worker-to-orchestrator messages in Pi

Investigated 2026-11-02. This is a source/history investigation and design recommendation, not an implementation. No running orchestration was modified.

## How the GoLinks workers learned to message

The orchestrator invented the communication convention; the workers did not independently discover the destination or transport.

Its session history shows this sequence:

1. Inspect `herdr agent --help` at 14:10:59Z.
2. Inspect `herdr agent prompt --help` and its own pane/session environment at 14:11:20Z.
3. Edit the shared Tickets `project.md` at 14:12:05Z, adding an explicit instruction to send completion and urgent notices using `herdr agent prompt w5:p4 '<concise report notice>'`, without `--wait`. It also specifies the contents: ticket number, finding titles/count, baseline, and private report path.
4. Spawn eight audit workers at 14:13:42Z.

Sources: [orchestrator session](</Users/elioshinsky/.pi/agent/sessions/--Users-elioshinsky-code-my-go-links--/2026-11-02T04-30-28-566Z_01a19a85-e4d4-734d-aa42-6bd1fc4383c6.jsonl>) lines 1108, 1111, 1114, 1126; [shared project contract](</Users/elioshinsky/.local/state/tickets/my-go-links/project.md>), final paragraph.

Worker018 actually calls the prescribed Herdr command at 14:15:44Z. Other inspected workers use the same destination with prefixes such as `Ticket011`, `Ticket013`, `Ticket017`, and `018`. The contract asks for ticket identification but does not prescribe that exact prefix syntax: the wording is model-authored, not harness-generated.

Source: [worker018 session](</Users/elioshinsky/.pi/agent/sessions/--Users-elioshinsky-code-my-go-links-018-deep-audit-sensitive-data-and-telemetry-leaks--/2026-11-02T14-13-57-977Z_01a19c9c-1858-7598-93f5-4c1a427d83f7.jsonl>) line 52; corresponding worker011/013/017 sessions discovered through read-only `herdr agent list`.

## The prompt-input concern is real

The installed first-party guidance (`herdr --skill`, “Start and coordinate an agent”) says `agent prompt` honors bracketed-paste mode and sends text followed by encoded Enter as one ordered submission. It is terminal input, not Pi's out-of-band message interface. Ordered submission does not isolate it from a human's existing editor contents. The audit notices consequently appear in the orchestrator's history as user messages, rather than identified harness notifications.

Sources: installed `herdr --skill`; orchestrator session above, user messages beginning 14:15:44Z.

## What already exists

### Orchestrator → worker: durable inbox plus steering

[`message-worker`](../../home/.agents/skills/orchestrator/scripts/message-worker) discovers the worker from published snapshots and atomically renames a private JSON file into:

```text
<coordinationRoot>/<orchestrationId>/inbox/<workerSessionId>/<messageId>.json
```

[`pr-watch.ts`](../../home/.pi/agent/extensions/pr-watch.ts):

- Lines 530–568 define the coordination root and addresses.
- Lines 575–627 ingest inbox files, validate them, deduplicate IDs, save pending messages to session state before removing files, and quarantine invalid files.
- Lines 917–923 poll a worker's inbox every five seconds, independently of the GitHub polling interval.
- Lines 1917–1966 steer an active worker with `pi.sendMessage(..., { triggerTurn: true, deliverAs: "steer" })` and requeue messages missing from the transcript after settlement/abort.
- Lines 1979–2029 deliver idle batches as custom harness messages that start a run.

This never types into the prompt editor. Pi's installed `sendCustomMessage` implementation queues custom messages through `agent.steer` while streaming and starts a custom-message run while idle; it does not write the editor. Source: [`agent-session.js`](</Users/elioshinsky/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js>) lines 1831–1885; [extension documentation](</Users/elioshinsky/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md>).

### Worker → orchestrator: automatic settlement reporting, not arbitrary messages

Workers publish their last assistant response in a snapshot when settled. The parent reports the latest settlement only if that settlement had no watched PR. This is not an explicit mid-run update channel, and updates use the ordinary PR Watch delivery loop rather than the worker inbox's five-second steering loop.

Sources: `pr-watch.ts` lines 721–740 (`captureWorkerSettlement`), 841–861 (`reconcileWorkerSettlements`), 1743–1745 (`buildWorkerSettlementMessage`), and 2442–2454 (`agent_settled`).

### Why a native tool fits better than environment-only CLI discovery

The launcher exports `PI_PARENT_ORCHESTRATION_SESSION_ID`, but PR Watch consumes and deletes that variable at startup, retaining the relationship in persisted `workerOrchestrationSessionId`. Resuming restores the persisted role. A CLI that merely reads the launch variable from a later Bash tool call would therefore not work reliably without additional identity plumbing. A native tool can use the extension's authoritative restored state and `ctx.sessionManager.getSessionId()` directly.

Sources: [`spawn-worker`](../../home/.agents/skills/orchestrator/scripts/spawn-worker) lines 156–165; `pr-watch.ts` lines 2340–2379, 646–659.

## Recommended shape (proposed, not implemented)

Expose one worker operation:

```typescript
message_orchestrator({ message: "Confirmed finding; private report at …" })
```

The worker supplies only the body. The harness derives its parent orchestration, sender Pi session, branch, and repository from existing state. No pane ID, arbitrary recipient, self-authored identity prefix, or delivery-mode choice is needed. Reject calls from non-worker sessions.

Use an explicit parent inbox under the existing orchestration directory, separate from snapshot JSON files and worker inboxes, for example:

```text
<coordinationRoot>/<orchestrationId>/orchestrator-inbox/<messageId>.json
```

A message envelope records version, ID, parent ID, sender session ID, repository, branch, creation time, and text. The parent validates membership and renders sender identity itself. These are local-process identities, not a security isolation mechanism against agents running as the same OS user.

The receiving extension delivers an identified custom message, for example:

```text
<orchestration-harness-notification>
Not a user message.
From worker: my-go-links@018-deep-audit-sensitive-data-and-telemetry-leaks
Sender session: …
Message ID: …

Confirmed finding; private report at …
</orchestration-harness-notification>
```

Poll locally on the existing five-second cadence; batch concurrent arrivals. Steer an actively running orchestrator at the next Pi-supported steering point, start a custom-message run when idle, and hold during manual compaction or session replacement. Do not change existing CI/feedback routing or steer every GitHub notification. Custom-message injection protects the draft from automated typing/submission; it does not promise that a background model run will never overlap the user's thinking.

Reuse the existing durable-inbox/steering implementation rather than creating an independent delivery stack, but tighten acknowledgment: persist pending state and only finalize delivery once the message ID appears in the destination transcript. Queue acceptance is not transcript delivery or semantic acknowledgment. The current running-worker path marks a steer delivered before transcript insertion and keeps its retry list only in memory, so it is not sufficient evidence of crash-safe delivery. Prefer replay with stable IDs over promising exactly-once execution.

Keep automatic no-PR settlement forwarding as a fallback; explicit messages provide early findings, questions, and blockers before settlement. Avoid instructing workers to repeat their entire final answer through both channels. Document the tool in the canonical worker instructions and forbid terminal prompting of the parent in the canonical orchestration instructions. Existing ad hoc project instructions must be migrated explicitly; installing a new tool alone will not remove the GoLinks contract's hard-coded Herdr command.

For Pi, implement the native tool first. Add a CLI adapter later only if a real non-Pi caller needs it, sharing the same envelope and durable delivery module rather than introducing a second protocol.
