---
name: orchestrator
description: Coordinate parallel ticket workers through repos worktrees, Pi sessions, pull-request review, squash merges, and filesystem tracker frontiers. Use when orchestrating implementation tickets rather than implementing one ticket directly.
---

# Orchestrator

Coordinate; do not implement worker tickets yourself. One ticket belongs to one ordinary Pi worker, one `repos` worktree, and one pull request. GitHub is the worker communication channel.

## Establish the run

Read `PI_ORCHESTRATION_SESSION_ID` before doing anything else. Stop clearly if it is absent. The user chooses the effort to orchestrate; do not impose a parent or map scope they did not request.

Read repository instructions and the configured tracker instructions. Use the Tickets CLI with concise human-readable output to inspect tickets, assignment, blockers, and status. Never request JSON from Tickets. Use `tickets --help` when command syntax is uncertain.

## Advance the frontier

Find every non-`done`, executable, unassigned, unblocked ticket in the requested effort. Apply the repository tracker’s frontier rules and the scope the user requested. Never spawn a map, parent, or other container ticket itself; its completion is orchestrator bookkeeping after its executable children resolve. Start all independent frontier tickets without waiting between them:

```text
spawn-worker <ticket-name>
```

Do not claim worker tickets. `spawn-worker` supplies the worker identity and handoff.

After handoff, never send manual instructions into a healthy worker's tmux session. Do not poll or capture its pane as the normal communication loop. The worker opens a PR and watches it; communicate through ordinary PR comments or GitHub reviews so its existing PR Watch receives the feedback.

## Process worker PRs

PR Watch announces matching worker PRs and later CI or feedback activity. For every review-ready PR:

1. Inspect the current PR head, complete diff, ticket, applicable contracts, existing comments and unresolved threads, mergeability, and required checks.
2. Inspect actual generated output or diffs from formatting, code generation, snapshots, schemas, or similar checks; a green status alone is not evidence that generated changes are intended.
3. Run isolated review with `run_code_review`, directing it to the worker worktree and exact PR diff. When multiple PRs are ready, emit one `run_code_review` call per PR in the same response so they execute concurrently.
4. Verify findings against the accepted scope. Reject false positives and requirements not established by the ticket or repository contracts.
5. Publish one finding with an ordinary PR comment when one comment is sufficient. Use a GitHub review when grouping multiple or inline findings is clearer.
6. Never request review by tagging any bot in a PR comment. Workers' existing self-requested review behavior remains unchanged.

Workers receive PR feedback through their own PR Watch, make fixes, and push. A small, obvious response to already-reviewed feedback may be verified directly from the exact diff and relevant checks. Run `run_code_review` again when a change is broad, semantic, conflict-heavy, crosses boundaries, or cannot be safely verified by inspection.

Do not edit, commit, or push worker branches. Do not merge merely because CI is green.

## Merge and resolve

Squash merge only. Merge when the implementation and PR description satisfy the ticket, required checks pass on the relevant head, generated changes are intentional, actionable review findings are resolved, and the PR is mergeable.

After each merge, follow the repository's demonstrated tracker resolution process without redesigning it:

1. Update the main worktree with a fast-forward-only pull.
2. Append the required concise resolution and merged PR/commit evidence to the ticket.
3. Run `tickets done <ticket-name>` so downstream blockers are removed.
4. Update parent or map bookkeeping required by the tracker instructions.
5. Run `tickets lint`.
6. Run `repos clean <ticket-name>` to remove the merged worktree and worker session.
7. Find and spawn the newly unblocked frontier immediately.

Continue until the requested effort has no unresolved tickets.

## Recovery

After interruption, use `repos list`, tracker state, and GitHub PR state as sources of truth. Reconcile merged, open, and unstarted tickets. Resume only workers that still need changes using ordinary Pi continuation in the existing `repos` session. The normal loop remains PR-based; recovery does not grant permission to implement worker changes from the orchestrator.
