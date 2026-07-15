# Pi extensions

Tracked first-pass Pi extensions for this dotfiles setup.

- `permission-gate.ts`: ask/block bash commands matching `permissionGate.bash` patterns in Pi settings
- `protected-paths.ts`: block writes to secret or generated paths
- `status-line.ts`: show simple turn progress in the footer
- `model-status.ts`: notify when the active model changes
- `pr-watch.ts`: session-local multi-PR watcher that wakes after PR/git push activity, batches CI and feedback updates until the agent settles, and supports paused delivery while polling continues
- `trust-all.ts`: automatically trust every project to bypass project trust prompts
- `plan-mode/`: read-only planning mode with extracted steps and execution tracking
- `otel-tracing/`: export session, prompt, LLM, and tool traces over OpenTelemetry

Possible later additions from the upstream examples:

- `subagent/`
