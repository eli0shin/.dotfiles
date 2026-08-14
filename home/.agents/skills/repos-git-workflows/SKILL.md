---
name: repos-git-workflows
description: Enforces `repos` for worktrees and rebases. Use when creating, resuming, or switching to a worktree, stacking a branch, rebasing or updating a branch onto its base or parent, or resolving, continuing, or aborting a rebase.
---

# repos Git Workflows

`repos` owns branch ancestry, stack relationships, worktrees, and paused rebases. Git owns synchronization between the current branch and its configured upstream.

## Choose the updater

First identify which relationship must change:

- If the current branch is behind or has diverged from its configured upstream, run `git pull`. This includes a push rejected because the remote branch is ahead. After the pull succeeds, retry the push.
- If the branch must move onto its recorded parent or base branch, use the `repos` workflow below.

A remote-tracking update is complete when `git status` shows that the current branch is up to date with its upstream. It is not a branch-ancestry update.

## Guardrails

Before choosing a worktree or rebasing a branch, run `repos list`. Treat its recorded stack and worktree state as authoritative; do not infer relationships from branch names or Git history.

Never run raw `git rebase`, `git rebase --continue`, or `git worktree`. Use `git rebase --abort` only to abandon a paused operation.

## Choose the operation

- Create or resume an independent worktree: `repos work --no-tmux <branch>`
- Create a child stacked on the current branch: `repos stack --no-tmux <child>`
- Rebase a branch onto its recorded parent, or the default branch when independent: `repos rebase`
- Rebase only that branch, excluding its children: `repos rebase --only`

Use `repos <command> --help` for arguments and options. After `work` or `stack`, continue all work from the path it prints.

## Paused rebase

Resolve conflicts with Git, stage every resolved file, then run:

```bash
git status
git add <resolved-files>
repos continue
```

Never substitute `git rebase --continue`. To abandon the rebase, run `git rebase --abort`.
