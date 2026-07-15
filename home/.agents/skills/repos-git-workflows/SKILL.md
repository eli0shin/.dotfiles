---
name: repos-git-workflows
description: Enforces `repos` for worktrees and rebases. Use when creating, resuming, or switching to a worktree, stacking a branch, rebasing or updating a branch onto its base or parent, or resolving, continuing, or aborting a rebase.
---

# repos Git Workflows

`repos` owns branch ancestry, stack relationships, worktrees, and paused rebases. Raw Git does not maintain its metadata.

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
