# Open GitHub pull requests in Diffview

## Question

Can Diffview open a GitHub pull request diff, and what should a Fish command do to make that workflow direct?

## Finding

Diffview supports pull request review through Git revision ranges, but it does not accept a pull request number or URL as a pull request selector. Its command accepts a Git revision, and its official pull request guide tells users to check out the pull request with `gh pr checkout` and then run:

```vim
:DiffviewOpen origin/HEAD...HEAD --imply-local
```

The three-dot range compares the pull request head with its merge base in the base branch. GitHub also documents that pull requests use a three-dot comparison. The `--imply-local` option uses working-tree files on the right side so that LSP features remain available.

Sources:

- [Diffview usage: Review a PR](https://github.com/sindrets/diffview.nvim/blob/main/USAGE.md#review-a-pr)
- [Diffview command documentation](https://github.com/sindrets/diffview.nvim/blob/main/doc/diffview.txt)
- [GitHub branch comparison documentation](https://docs.github.com/en/pull-requests/reference/branches#three-dot-and-two-dot-git-diff-comparisons)

## Direct command design

A Fish command can remove the manual checkout and prompt steps:

1. Accept an optional pull request number, URL, or branch. With no argument, select the pull request for the current branch.
2. Use `gh pr view` to resolve the selector and read the pull request number, base branch, and URL.
3. Fetch the pull request head and base into private local refs. GitHub exposes pull request commits through `refs/pull/ID/head`, including pull requests from forks.
4. Start Neovim with `DiffviewOpen <base-ref>...<head-ref>`.

This design does not change the checked-out branch or working tree. Both Diffview buffers represent committed Git objects, so the right side does not get the local-file and LSP benefit of `--imply-local`. The official checkout-based workflow can provide that benefit, but it changes the current checkout.

`gh pr view` supports a pull request number, URL, or branch. With no selector, it finds the pull request for the current branch. Its JSON output includes the base and head names and object IDs.

Sources:

- [`gh pr view` manual](https://cli.github.com/manual/gh_pr_view)
- [`gh pr checkout` manual](https://cli.github.com/manual/gh_pr_checkout)
- [GitHub: Checking out pull requests locally](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally)

## Watch behavior

Diffview refreshes when its local Git data changes, but it does not poll GitHub for new pull request commits. The PR watcher only needs to poll the feature branch's `headRefOid`. A normal base branch advance does not change the three-dot diff's merge base. If the feature branch merges or rebases the new base commits, its head also changes.

When the head changes, the current Diffview remains pinned to its original commits and shows an `OUTDATED` status. `:PRDiffReload` or `<leader>dvr` fetches both refs, reopens the view, and restores the selected file. This makes the update explicit and prevents the diff from changing while it is being reviewed.

This intentionally does not detect the rare cases where the base branch is force-pushed or the pull request is retargeted to another base branch.

## Recommendation

Start with a non-mutating command:

```text
pr [number | URL | branch]
```

It should resolve the pull request with `gh`, fetch its base and head into private refs, and open their three-dot range in Diffview. With no argument, it should use the pull request for the current branch. Add watch behavior only if manual reopening becomes a problem.

The name `pr` shadows the system `/usr/bin/pr` text-pagination command in Fish. This is usually acceptable for an interactive shortcut, but `dvpr` is available if that collision is not wanted.
