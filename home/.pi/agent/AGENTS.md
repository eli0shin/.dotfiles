## Global defaults

- Start by reading any project `AGENTS.md`, `CLAUDE.md`, or `README.md` files that apply in the current directory.
- Follow existing repo conventions and extend existing patterns before inventing new ones.
- Keep changes scoped to the request; do not refactor unrelated code.
- Do not commit, push, or run destructive commands unless explicitly asked.
- Keep secrets, local auth, and machine-specific state out of tracked files.
- After code changes, run the smallest relevant verification command and report what changed clearly.
- After completing non-trivial code changes, call the `run_code_review` tool before your final response to self-review. Skip it only for documentation-only, trivial, or explicitly-excluded changes.
- Treat `run_code_review` findings as advisory: verify each against the code and address only valid, in-scope issues; note anything you judge a false positive.
