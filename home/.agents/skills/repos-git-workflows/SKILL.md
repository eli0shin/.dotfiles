---
name: repos-git-workflows
description: Guides agents to use the repos CLI for git branch, rebase, stack, and worktree workflows. Use globally whenever working with git branches, rebasing, stacked branches, worktrees, rebase conflict resolution, branch cleanup, or commands that might otherwise use git rebase or git worktree.
---

# repos Git Workflows

`repos` is the required interface for rebasing and worktrees. It tracks stack relationships, fork-point refs, continuation state, worktree locations, and cleanup conventions that raw git does not maintain.

## Non-negotiable rules

- Never run raw `git rebase ...`.
- Never run raw `git rebase --continue`.
- Never run raw `git worktree ...`.
- Always use `repos list` to identify repo/worktree state, especially whether the current worktree is stacked.
- Raw git is allowed only for inspection and conflict resolution: `git status`, `git diff`, `git log`, `git branch`, `git add`, `git restore`, and `git rebase --abort` when abandoning a paused operation.

## Start here

Before any branch sync, rebase, stack, worktree, or cleanup action:

```bash
git status --short
repos list
```

Use `repos list` output to determine whether the current branch/worktree is stacked. Do not rely on generic heuristics like branch naming or merge-base guesses.

## Command mapping

| Intent | Use |
| --- | --- |
| Create/resume independent worktree | `repos work --no-tmux <branch>` |
| Create child branch stacked on current branch | `repos stack --no-tmux <child-branch>` |
| Rebase independent branch on default branch | `repos rebase` |
| Rebase stacked branch on parent | `repos restack` |
| Rebase current stacked branch only | `repos restack --only` |
| Continue after conflicts | `repos continue` |
| Make stacked branch independent | `repos unstack` |
| Collapse parent into current branch | `repos collapse` |
| Preview/squash commits since base | `repos squash --dry-run`, then `repos squash -m "message"` |
| Remove/cleanup worktrees | `repos clean <branch>`, `repos cleanup --dry-run`, `repos cleanup` |

Prefer `--no-tmux` for agent-created/resumed worktrees unless the user explicitly asks for tmux.

## Worktree directories

`repos work` and `repos stack` create worktrees in sibling directories, not inside the current checkout. After creating or resuming a worktree, switch all further file reads, edits, tests, and git commands to the path printed by `repos`.

Example:

```bash
path=$(repos work --no-tmux feature-x)
cd "$path"
```

Once a worktree is created for the target branch, treat that sibling worktree as the active project directory for the task unless there is a deliberate reason to inspect another checkout.

## Updating a branch

1. Run `git status --short` and `repos list`.
2. If `repos list` shows the current worktree/branch is stacked, run `repos restack`.
3. If it is stacked but children should not be restacked, run `repos restack --only`.
4. If `repos list` shows it is not stacked, run `repos rebase`.
5. Follow `repos` output exactly. If conflicts pause the operation, use the conflict workflow below.

## Conflict workflow

When a `repos` operation pauses with conflicts:

```bash
git status
# edit conflicted files
git add <resolved-files>
repos continue
```

Do not use `git rebase --continue`; it bypasses `repos` fork-point and continuation bookkeeping.

To abandon a paused rebase/restack:

```bash
git rebase --abort
repos list
```

## Stacked branch guidance

- Use `repos stack --no-tmux <child>` for work that depends on the current branch.
- Use `repos restack` after parent changes, squashes, or amendments.
- If the parent was merged/deleted, still use `repos restack`; it detects missing parents, rebases onto `origin/<default>`, and removes stale stack relationships.
- Use `repos unstack` when intentionally making a child independent.
- Use `repos collapse` when intentionally combining parent work into the current stacked branch.

## Worktree cleanup

Preview first with `repos cleanup --dry-run`, then run `repos cleanup` if appropriate. Remove a specific worktree with `repos clean <branch>`. Use `--force` only when the user explicitly accepts removing a parent with stacked children.
