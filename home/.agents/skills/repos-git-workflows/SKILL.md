---
name: repos-git-workflows
description: Enforces `repos` for worktrees and rebases. Use when entering a worktree, stacking a branch, updating a branch onto its parent or base, or finishing a paused rebase.
---

# repos Git Workflows

Every worktree, stack, and rebase operation goes through `repos`. `repos` owns branch ancestry, stack relationships, worktrees, and paused rebases. Git owns synchronization between the current branch and its upstream.

## 1. Read the recorded state

Run `repos list`. Its stack and worktree state is authoritative over branch names and Git history.

## 2. Run the operation

Worktrees — continue all work from the path the command prints:

- Enter a worktree for an independent branch: `repos work <branch>`
- Create a child branch stacked on the current branch: `repos stack <child>`

Updates — first identify which relationship changed:

- The current branch is behind or diverged from its upstream, including a rejected push: `git pull`, then retry the push. Done when `git status` reports the branch is up to date with its upstream.
- The branch must move onto its recorded parent, or onto the default branch when independent: `repos rebase` with no arguments, from inside the branch's worktree. It rebases the branch and its children.

`repos <command> --help` lists arguments and options.

## 3. Finish a paused rebase

When `repos rebase` pauses on conflicts, resolve them in Git, then:

```bash
git add <resolved-files>
repos continue
```

Repeat until `git status` shows no rebase in progress. To abandon the rebase: `git rebase --abort`.
