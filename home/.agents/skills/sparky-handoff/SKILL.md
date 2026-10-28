---
name: sparky-handoff
description: Hand off a written Jira ticket to Sparky, the ffs-mono-repo agent in Slack, as a worker that opens the PR. Use when Eli asks to delegate, hand off, or give a ticket to Sparky.
---

# Sparky handoff

Sparky is a **worker**, the same as one started with `spawn-worker`: you plan the ticket with Eli, Sparky writes a spec and builds it, and you own the spec check, the review, and the merge. Everything goes through one Slack thread in #sparky-operations, posted from Eli's account: Sparky lets only the requester approve its spec.

| | ID |
|---|---|
| #sparky-operations | `C0B7X5NRH08` |
| Sparky (mention as `<@U0BEQTPU5SS>`) | user `U0BEQTPU5SS`, bot `B0BESU2DSKC` |

Between steps, **yield**: end the turn and let Slack Watch or PR Watch wake you. Never poll with `sleep`.

## 1. Hand off

The ticket is already written and agreed with Eli. Post it and watch the reply thread:

```bash
slackcli messages send --recipient-id C0B7X5NRH08 --message "<@U0BEQTPU5SS> can you work on FCC-1234" --json
```

Call `watch_slack` with `target: "C0B7X5NRH08"`, `thread_ts` set to the returned `ts`, and `note: "Sparky FCC-1234"`, then yield.

## 2. Answer Sparky's questions

Sparky reads the ticket against `main` and posts numbered questions, each with its recommendation. Answer from the decisions settled while writing the ticket, and ask Eli about anything those decisions leave open. Reply in the thread, mentioning Sparky:

```bash
slackcli messages send --recipient-id C0B7X5NRH08 --thread-ts <thread-ts> --message "<@U0BEQTPU5SS> 1. yes 2. keep the current design 3. yes"
```

## 3. Read the spec, then approve it

Sparky posts a spec card whose buttons are `work_order_approve` and `work_order_decline`, linking `assignments/<KEY>/spec.md` at a commit. Read the whole spec at that commit:

```bash
gh api 'repos/fanatics-gaming/ffs-mono-repo/contents/assignments/FCC-1234/spec.md?ref=<commit>' --jq .content | base64 -d
```

Check it against the ticket and the planning with Eli: every acceptance criterion builds what was agreed, nothing agreed is missing or under "Not doing", and nothing unplanned is added. The check is done when each agreed outcome maps to an acceptance criterion.

- **It matches:** click Approve. Sparky rewrites the card to "Approved by …" and starts building.
  ```bash
  ~/.agents/skills/sparky-handoff/scripts/slack-click-button C0B7X5NRH08 <card-ts> work_order_approve --yes
  ```
- **It drifts:** reply in the thread with the correction. Sparky posts a revised spec card; read that one too.

## 4. Watch the PR

Sparky posts "Started working on …", then "Opened a draft PR: <url>". Call `watch_pr` with the PR URL and yield. Sparky marks the PR ready once CI passes and posts its own review on it.

## 5. Review and merge

The reviewer reads code from a local checkout, so give it one at the PR head. From the ffs-mono-repo checkout, `repos work <pr-branch> --no-tmux` creates a worktree tracking Sparky's branch and prints its path; on later heads, `git -C <path> pull`.

When CI passes on a new head, call `run_code_review` with a `taskContext` naming the worktree path, PR URL, head SHA, ticket key, and spec link, and asking for the reviewed head SHA back. Treat its findings as you would a worker's:

- **Actionable findings:** send the accepted ones to Sparky in the thread, mentioning it, and yield for the new head.
- **Clean review with passing checks, and the reviewed SHA is the PR's current head:** approve and squash merge from Eli's account:
  ```bash
  gh pr review <pr> --approve
  gh pr merge <pr> --squash --match-head-commit <reviewed-head-sha>
  ```

Sparky then posts "<KEY> is done." Call `unwatch_slack` for the thread and remove the worktree with `repos clean <pr-branch> --no-tmux`. The handoff is complete when the PR is merged, the thread is unwatched, and the worktree is gone.
