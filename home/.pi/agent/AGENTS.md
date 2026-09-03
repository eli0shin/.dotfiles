## Global defaults

- Start by reading any project `AGENTS.md`, `CLAUDE.md`, or `README.md` files that exist in the current directory only.
- Follow existing repo conventions and extend existing patterns before inventing new ones.
- Keep changes scoped to the request; do not refactor unrelated code.
- After completing non-trivial code changes, call the `run_code_review` tool before your final response to self-review. Skip it only for documentation-only, trivial, or explicitly-excluded changes.
- Treat `run_code_review` findings as advisory: verify each against the code and address only valid, in-scope issues; note anything you judge a false positive.
- Always talk in ASD-STE100 Simplified Technical English. Always read CONTEXT.md files, and use their ubiquitous language.
- Avoid mannered prose. Always communicate clearly and concisely.
