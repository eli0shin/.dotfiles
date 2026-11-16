---
name: review-comments
description: Read the local review comments saved for the pull request, branch, or directory under review.
---

Read the review comments file for the work under review. `<org>/<repo>` is the GitHub owner and name of the repository's `origin` remote.

- Pull request: `/tmp/review/<org>/<repo>/<pull-request-number>.txt`
- No pull request (uncommitted or unpushed changes): `/tmp/review/current/<org>/<repo>/<branch>.txt`, where `<branch>` is the output of `git branch --show-current`
- No `origin` remote, a detached HEAD, or outside git: `/tmp/review/local/<root>.txt`, where `<root>` is the absolute path of the git top level (`git rev-parse --show-toplevel`), or of the directory Neovim was opened in, without its leading `/`. For example, comments on `~/code/workbench` are in `/tmp/review/local/Users/<user>/code/workbench.txt`.
