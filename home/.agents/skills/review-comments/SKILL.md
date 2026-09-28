---
name: review-comments
description: Read the review comments saved for the pull request or branch under review.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

Read the review comments file for the work under review. `<org>/<repo>` is the GitHub owner and name of the repository's `origin` remote.

- Pull request: `/tmp/review/<org>/<repo>/<pull-request-number>.txt`
- No pull request (uncommitted or unpushed changes): `/tmp/review/current/<org>/<repo>/<branch>.txt`, where `<branch>` is the output of `git branch --show-current`
