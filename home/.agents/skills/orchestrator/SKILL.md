---
name: orchestrator
description: Coordinate parallel ticket workers as an event-driven control plane through repos worktrees, Pi sessions, delegated pull-request review, squash merges, and filesystem tracker frontiers. Use when orchestrating implementation tickets rather than implementing or reviewing one ticket directly.
---

# Orchestrator

Act as an **event-driven control plane**. Coordinate workers and reviewers. One executable ticket belongs to one ordinary Pi worker, one `repos` worktree, and one pull request. The harness watches matching worker PRs and injects notifications into this session for relevant PR events; this facility is called PR Watch. **Yield** by ending the turn without polling; PR Watch re-enters on relevant activity.

## Hard boundary

Never implement ticket changes yourself. After spawning a worker:

- Never poll GitHub, CI, a worker session, or a worker worktree.
- Never read a worker diff, changed file, or worker worktree yourself; delegate change inspection to `run_code_review`. You may read the PR description, comments, and reviews to direct the review and judge feedback against the ticket, ADRs, designs, and repository contracts.
- Never edit, commit, or push a worker branch, and never send manual instructions into a healthy worker's tmux session.

If information is missing, ask for it in a concise PR comment, wait for an event, or delegate another review. Do not inspect worker changes to answer it directly.

## Establish the run

Read `PI_ORCHESTRATION_SESSION_ID` before doing anything else. Stop clearly if it is absent. The user chooses the effort to orchestrate; do not impose a parent or map scope they did not request.

Read repository instructions and the configured tracker instructions. Use the Tickets CLI with concise human-readable output to inspect tickets, assignment, blockers, and status. Never request JSON from Tickets. Use `tickets --help` when command syntax is uncertain.

This step is complete when the requested effort and its executable frontier are known.

## Advance the frontier

Find every non-`done`, executable, unassigned, unblocked ticket in the requested effort. Apply the repository tracker’s frontier rules and the requested scope. Never spawn a map, parent, or other container ticket; its completion is orchestrator bookkeeping after its executable children resolve.

Start all independent frontier tickets without waiting between them:

```text
spawn-worker <ticket-name>
```

Do not claim worker tickets; `spawn-worker` supplies the worker identity and handoff. This step is complete when every currently executable frontier ticket has a worker. Then yield.

## Dispatch PR events

On each PR Watch event, read the PR description and current comments and reviews without opening the diff or changed files. Then call `run_code_review`. In `focus`, direct the reviewer to the worker worktree, PR, ticket, triggering event, and relevant feedback, with this required return contract:

- reviewed head commit SHA;
- ticket and contract compliance;
- complete actionable findings and unresolved feedback;
- required-check and generated-output verdict;
- mergeability verdict;
- one recommendation: `WAIT`, `FEEDBACK`, or `MERGE`.

The reviewer inspects the complete diff, files, PR metadata, comments, threads, checks, and actual generated outputs. When multiple PR events arrive together, emit one `run_code_review` call per PR in the same response so reviews run concurrently.

A review cycle is complete only when a delegated verdict covers the current head commit and every item in the return contract. If the result is incomplete, delegate a follow-up review.

## Route the verdict

Act as the final authority on review feedback. Assess delegated findings and existing PR feedback against the ticket, ADRs, designs, and repository contracts using the returned evidence and allowed PR context; do not pass through feedback that conflicts with those sources. Workers receive accepted feedback through their own PR Watch, make fixes, and push. Every new head or relevant activity requires a fresh delegated verdict.

- `WAIT`: yield.
- `FEEDBACK`: publish the delegated actionable findings through one ordinary PR comment, or a GitHub review when grouping multiple or inline findings is clearer. Never request review by tagging a bot. Then yield.
- `MERGE`: only when the delegated verdict confirms the reviewed head satisfies the ticket, required checks passed, generated changes are intentional, actionable findings are resolved, and the PR is mergeable, squash merge with `gh pr merge <pr> --squash --match-head-commit <reviewed-head-sha>`. If the head precondition fails, yield until a fresh verdict; otherwise resolve the merge.

## Resolve a merge

After each merge, follow the repository's demonstrated tracker resolution process without redesigning it:

1. Update the main worktree with a fast-forward-only pull.
2. Append the required concise resolution and merged PR/commit evidence to the ticket.
3. Run `tickets done <ticket-name>` so downstream blockers are removed.
4. Update parent or map bookkeeping required by tracker instructions.
5. Run `tickets lint`.
6. Run `repos clean <ticket-name>` to remove the merged worktree and worker session.
7. Find and spawn the newly unblocked frontier immediately.

This step is complete when tracker evidence is recorded, cleanup succeeds, lint passes, and every newly executable ticket has a worker. Then yield.

## Recovery

After interruption, use `repos list` and tracker state to reconstruct tickets and workers. Let PR Watch rediscover matching PRs. Resume only workers that still need changes using ordinary Pi continuation in the existing `repos` session. Recovery does not relax the hard boundary.

The run is complete when the requested effort has no unresolved executable tickets and required container bookkeeping is resolved.
