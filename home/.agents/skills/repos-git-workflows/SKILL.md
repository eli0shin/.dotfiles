---
name: repos-git-workflows
description: Enforces `repos` for Git topology changes. Use when working with branches, rebases, stacks, worktrees, rebase conflicts, or branch/worktree cleanup.
---

# repos Git Workflows

`repos` owns Git topology: branch ancestry, stack relationships, worktrees, and paused rebases. Raw git does not maintain its metadata.

## Guardrails

Before changing branch topology:

```bash
git status --short
repos list
```

Treat `repos list` as the source of truth for stack and worktree state; never infer stacked state from names or merge bases.

Never run raw `git rebase`, `git rebase --continue`, or `git worktree`. Raw git is limited to inspection and conflict resolution (`status`, `diff`, `log`, `branch`, `add`, `restore`) plus `git rebase --abort` when abandoning a paused operation.

## Commands

| Intent | Command |
| --- | --- |
| Create/resume an independent worktree | `repos work --no-tmux <branch>` |
| Create a child stacked on the current branch | `repos stack --no-tmux <child>` |
| Sync an independent branch with the default branch | `repos rebase` |
| Sync a stacked branch and its children with its parent | `repos restack` |
| Sync only the current stacked branch | `repos restack --only` |
| Continue after resolving conflicts | `repos continue` |
| Make the current stacked branch independent | `repos unstack` |
| Collapse its parent into the current branch | `repos collapse` |
| Preview, then squash commits since the base | `repos squash --dry-run`; `repos squash -m "message"` |
| Remove one worktree | `repos clean <branch>` |
| Preview, then clean eligible worktrees | `repos cleanup --dry-run`; `repos cleanup` |

For branch sync, choose `rebase`, `restack`, or `restack --only` from the topology reported by `repos list`. If a stacked parent was merged or deleted, still use `repos restack`; it rebases onto `origin/<default>` and removes the stale relationship.

## Paused conflicts

```bash
git status
# resolve files
git add <resolved-files>
repos continue
```

Never substitute `git rebase --continue`. To abandon the operation, run `git rebase --abort`, then `repos list`.

## Worktrees

Prefer `--no-tmux` unless the user asks for tmux. `repos work` and `repos stack` create sibling worktrees; after either command, move all reads, edits, tests, and Git commands to the printed path:

```bash
path=$(repos work --no-tmux feature-x)
cd "$path"
```

Preview cleanup first. Use `--force` only when the user explicitly accepts removing a parent with stacked children.
