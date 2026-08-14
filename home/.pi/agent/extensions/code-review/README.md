# pi code-review

Runs code review in an isolated in-process pi SDK session, without polluting the
main conversation context.

Two entry points:

- **`/code-review`** — slash command. Runs the review, then surfaces findings in a UI
  overlay with **Send to agent / Save to file / Ignore**. Nothing is injected into
  the conversation unless you choose *Send to agent*.
- **`run_code_review`** — tool the main agent can call to start a self-review.
  The result includes the findings and a persistent review session ID.
- **`continue_code_review`** — tool the main agent can call with that exact ID to
  re-review changes in the same reviewer conversation. It has no slash command.

All entry points present findings to the agent through the same advisory wrapper.
They use isolated, persistent SDK sessions. Other user extensions stay disabled;
the Exa extension is loaded for `web_search_exa` and
`web_fetch_exa`. The explicit tool allowlist is `read`, `grep`, `find`, `ls`,
`bash`, `web_search_exa`, and `web_fetch_exa`. Review JSONL files are stored in
`~/.pi/agent/code-review-sessions/`, separate from normal Pi sessions, so they do
not affect `pi -c` or `/resume`. The subagent is instructed to use the
`code-review` skill and not modify files.

## `/code-review` usage

```text
/code-review                          # current changes, or branch/PR changes vs base
/code-review FCC-114: add retry limits # same review, with task context
```

Arguments are treated as optional task context. Include the original request,
ticket key, requirements, acceptance criteria, and constraints when available.
The context does not select review areas or establish findings. Scoped review
arguments such as `branch <ref>` and `commit <sha>` are not currently parsed.

## Review continuation

`run_code_review` returns a full review session ID. To re-review fixes, call
`continue_code_review` with that exact ID. The continued reviewer retains its
prior prompt, research, tool calls, and findings. The continuation prompt tells
it to retract prior findings when new evidence shows that they were false or out
of scope.

Continuation never selects the latest review and does not accept partial IDs.
It rejects IDs that are not in the dedicated review directory for the current
working directory.

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
