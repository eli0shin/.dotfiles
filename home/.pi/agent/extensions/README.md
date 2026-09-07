# Pi extensions

Tracked first-pass Pi extensions for this dotfiles setup.

- `permission-gate.ts`: ask/block bash commands matching `permissionGate.bash` patterns; its `rmPolicy` allows removal in Git repositories and temporary directories, blocks direct removal of home or `/`, blocks recursive removal elsewhere, and asks for non-recursive removal elsewhere
- `protected-paths.ts`: block writes to secret or generated paths
- `status-line.ts`: show simple turn progress in the footer
- `model-status.ts`: notify when the active model changes
- `pr-watch.ts`: session-local multi-PR watcher that wakes after PR/git push activity, batches CI and feedback updates until the agent settles, supports paused delivery while polling continues, shares worker watch membership with parent orchestration sessions, and reports settled workers that have no watched PR
- `orchestrator.ts`: append the canonical `~/.agents/skills/orchestrator/SKILL.md` instructions to the system prompt before each agent run when `PI_ORCHESTRATION_SESSION_ID` is set; role instructions stay outside compacted conversation history, and PR Watch restores the variable on resume. Workers with only `PI_PARENT_ORCHESTRATION_SESSION_ID` keep their ordinary role. Use `/reload` to load this extension in an existing session.
- `trust-all.ts`: automatically trust every project to bypass project trust prompts
- `visible-markdown-links.ts`: keep assistant Markdown links clickable and print each hidden external URL after its label
- `plan-mode/`: read-only planning mode with extracted steps and execution tracking
- `otel-tracing/`: export session, prompt, LLM, and tool traces over OpenTelemetry

Possible later additions from the upstream examples:

- `subagent/`
