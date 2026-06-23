# pi code-review

Runs code review in an isolated in-process pi SDK session, without polluting the
main conversation context.

Two entry points:

- **`/code-review`** — slash command. Runs the review, then surfaces findings in a UI
  overlay with **Send to agent / Save to file / Ignore**. Nothing is injected into
  the conversation unless you choose *Send to agent*.
- **`run_code_review`** — tool the main agent can call to self-review its own
  changes. The findings are always returned to the agent as the tool result. The
  global `AGENTS.md` nudges the agent to call it after non-trivial changes.

Both entry points create an isolated SDK session with extensions disabled and an
explicit tool allowlist: `read`, `grep`, `find`, `ls`, and `bash`. The subagent is
instructed to use the `code-review` skill and not modify files.

## `/code-review` usage

```text
/code-review                          # current changes, or branch/PR changes vs base
/code-review focus on tests           # same review, with extra guidance
```

Arguments are treated as optional focus guidance for the reviewer. Scoped review
arguments such as `branch <ref>` and `commit <sha>` are not currently parsed.

While running, a widget appears above the editor. When the review finishes you get
an overlay with the markdown-rendered findings and the action choices.

## Files

- `index.ts` — command + tool registration and orchestration
- `code-review-runner.ts` — creates the isolated SDK session, streams output, and reports failures
- `code-review-message.ts` — builds the review task prompt and the advisory message
- `code-review-ui.ts` — the overlay and in-progress widget
- `types.ts` — shared types

## Development

```bash
npm install
npm run check   # typecheck + tests
```
