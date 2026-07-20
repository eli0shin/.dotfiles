---
name: orchestrator
description: Coordinate parallel ticket workers as an event-driven control plane through repos worktrees, Pi sessions, delegated pull-request review, squash merges, and filesystem tracker frontiers. Use when orchestrating implementation tickets rather than implementing or reviewing one ticket directly.
---

# Orchestrator

Act as an **event-driven control plane**. Coordinate workers and reviewers. One executable ticket belongs to one ordinary Pi worker, one stacked `repos` worktree, and one pull request into the orchestration landing branch. Workers publish their ordinary PR Watch membership to the harness, which watches the union of their PRs and injects notifications into this session for relevant PR events. **Yield** by ending the turn instead of blocking on a watch command or repeatedly checking for changes; PR Watch re-enters on relevant activity.

## Hard boundary

Never implement ticket changes yourself. After spawning a worker:

- Never block the orchestration loop with `gh pr watch`, `gh run watch`, repeated `sleep`/status loops, or manual watching of GitHub, CI, worker sessions, or worker worktrees. One-shot state retrieval is not polling: use `gh pr list`, `gh pr view`, `gh run view`, and equivalent metadata queries whenever needed to reconcile state, respond to the user, or direct a review.
- Never read a worker diff, changed file, or worker worktree yourself; delegate change inspection to `run_code_review`. You may fetch and read PR metadata, descriptions, comments, reviews, and check summaries to direct the review and judge feedback against the ticket, ADRs, designs, and repository contracts.
- Never edit, commit, or push a worker branch, and never send manual instructions into a healthy worker's tmux session.

If information is missing, ask for it in a concise PR comment, wait for an event, or delegate another review. Do not inspect worker changes to answer it directly.

## Establish the run

Read `PI_ORCHESTRATION_SESSION_ID` before doing anything else. Stop clearly if it is absent. Treat the current named branch as the landing branch for the entire run; stop if HEAD is detached and never switch branches. All worker branches stack on the landing branch and all worker PRs target it. The user chooses the effort to orchestrate; do not impose a parent or map scope they did not request.

Read repository instructions and the configured tracker instructions, then update the landing branch with a fast-forward-only pull. Before spawning, require it to track a same-named remote branch at exactly the same commit so every PR has a published base. Use the Tickets CLI with concise human-readable output to inspect tickets, assignment, blockers, and status. Never request JSON from Tickets. Use `tickets --help` when command syntax is uncertain.

This step is complete when the requested effort and its executable frontier are known.

## Advance the frontier

Find every non-`done`, executable, unassigned, unblocked ticket in the requested effort. Apply the repository tracker’s frontier rules and the requested scope. Never spawn a map, parent, or other container ticket; its completion is orchestrator bookkeeping after its executable children resolve.

Start all independent frontier tickets without waiting between them. Invoke the Bash script by its installed path so it works from Pi's Bash tool:

```bash
~/.agents/skills/orchestrator/scripts/spawn-worker <ticket-name>
~/.agents/skills/orchestrator/scripts/spawn-worker <ticket-name> --context "<steering context>"
printf '%s\n' "<steering context>" | ~/.agents/skills/orchestrator/scripts/spawn-worker <ticket-name>
```

Optionally provide concise steering context that is not already captured in the ticket. Do not summarize or restate existing instructions. `--context` accepts quoted text; when it is omitted, the script reads piped stdin if present.

Do not claim worker tickets; the script supplies the worker identity and handoff. This step is complete when every currently executable frontier ticket has a worker. Then yield.

## Dispatch PR events

On each PR Watch event, and whenever the user asks for current PR status, fetch each relevant PR with `gh pr view` before deciding what to do. Read the PR description, current comments, reviews, head SHA, target, mergeability, and check summaries without opening the diff or changed files. Then call `run_code_review` for every PR whose current head or landing-base compatibility needs inspection. In `focus`, direct the reviewer to the worker worktree, PR, ticket, triggering event, and relevant feedback, with this required return contract:

- reviewed head commit SHA;
- confirmation that the PR targets the landing branch;
- ticket and contract compliance;
- complete actionable findings and unresolved feedback;
- required-check and generated-output verdict;
- mergeability verdict.

The reviewer inspects the complete diff, files, PR metadata, comments, threads, checks, and actual generated outputs. When multiple PRs need review together, emit one `run_code_review` call per PR in the same response so reviews run concurrently.

A review cycle is complete only when delegated evidence covers the current head commit and every item in the return contract. If the result is incomplete, delegate a follow-up review.

## Act on the review

Act as the final authority on review feedback. Assess delegated findings and existing PR feedback against the ticket, ADRs, designs, and repository contracts using the returned evidence and allowed PR context; do not pass through feedback that conflicts with those sources. Derive the next action from the evidence rather than asking the reviewer for a routing label.

- If the worker must change code, resolve conflicts, update onto the current landing branch, regenerate outputs, or initiate missing verification, publish all accepted actionable findings through one ordinary PR comment or a GitHub review. Never request review by tagging a bot. Then yield for the worker's update.
- If no worker action is needed but checks or another external operation are already running, yield for the next event.
- Merge only when delegated evidence confirms the PR targets the landing branch, the reviewed head satisfies the ticket, checks passed against the current landing base, generated changes are intentional, actionable findings are resolved, and the PR is mergeable. Squash merge with `gh pr merge <pr> --squash --match-head-commit <reviewed-head-sha>`. If the head precondition fails, fetch the current PR state and obtain a fresh review before merging.

## Resolve a merge

After each merge, follow the repository's demonstrated tracker resolution process without redesigning it:

1. Update the landing-branch worktree with a fast-forward-only pull.
2. Append the required concise resolution and merged PR/commit evidence to the ticket.
3. Run `tickets done <ticket-name>` so downstream blockers are removed.
4. Update parent or map bookkeeping required by tracker instructions.
5. Run `tickets lint`.
6. Run `repos clean --no-focus <ticket-name>` to remove the merged worktree and worker session without leaving the landing branch.
7. Reconcile every remaining open worker PR with one-shot `gh pr list`/`gh pr view` calls. A landing merge may make another PR conflicted, behind, or leave its green checks tied to an obsolete merge base without producing a PR Watch event. Immediately comment on each affected PR asking its worker to update onto the current landing branch, preserve already-merged contracts, resolve conflicts, and rerun the relevant checks.
8. Find and spawn the newly unblocked frontier immediately.

This step is complete when tracker evidence is recorded, cleanup succeeds, lint passes, remaining PRs have been reconciled, and every newly executable ticket has a worker. Then yield.

## Recovery

After interruption, resume in the landing-branch worktree, then use `repos list`, tracker state, `gh pr list`, and one-shot `gh pr view` calls to reconstruct tickets, workers, PR heads, comments, checks, and mergeability. Let PR Watch restore worker-published membership, but do not assume it replayed events that occurred during the interruption. Resume only workers that still need changes using ordinary Pi continuation in the existing `repos` session. Recovery does not relax the boundary against inspecting or modifying worker changes directly.

The run is complete when the requested effort has no unresolved executable tickets, required container bookkeeping is resolved, and all completed ticket changes have landed on the landing branch.
