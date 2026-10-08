---
name: stacked-prs
description: Stacked PRs are a native GitHub feature managed with `gh stack`. Use when creating, updating, linking, rebasing, or merging stacked PRs, or stacking a PR on another PR.
---

A stacked PR is a native GitHub stack, created with the `gh stack` CLI extension, which links the PRs and shows them as one stack in the GitHub UI. A PR whose base branch is another PR's branch is only stacked once it belongs to that stack.

- Branches already exist (e.g. from `repos stack`): `gh stack link <bottom> ... <top>` (branch names or PR numbers, bottom to top) pushes them, opens any missing PRs, and creates the stack.
- Everything else: `gh stack --help`. Docs: https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands
- When rebasing a stack use the `repos rebase` flow instead of the `gh stack rebase` flow so that local tracking metadata stays in sync.
