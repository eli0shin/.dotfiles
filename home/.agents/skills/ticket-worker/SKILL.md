---
name: ticket-worker
description: Implement one ticket handed off by the orchestrator and open a PR for review.
---

# Ticket Worker

Implement the handed-off ticket. Follow the repository’s tracker instructions: confirm the ticket is unassigned, set `Assigned-To` to the supplied worker identity, and move it to `in-progress`.

Work only on this ticket. Follow its accepted contracts and the repository’s existing skills and conventions. Run the relevant checks and `run_code_review`.

Commit and push the changes, then open a PR against the supplied PR base using the `creating-prs` skill and `gh pr create --base <supplied-pr-base>`.

Do not merge the PR or resolve the ticket; the orchestrator owns that.

Do not poll the PR or its checks. PR Watch will deliver CI results and review feedback. Address that feedback, run the relevant checks and `run_code_review`, then commit and push the fixes.
