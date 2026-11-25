#!/usr/bin/env bash
# Raise Herdr and show its review pane (what Cmd+R shows, without toggling
# back when it's already shown). Run by the PR review notification's click.
set -euo pipefail

PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

open -a "$HOME/Applications/Herdr.app"

# A freshly launched window needs a moment before navigator-status takes commands.
for ((i = 0; i < 40; i++)); do
  herdr-app "do" navigator-status.review-show >/dev/null 2>&1 && exit 0
  sleep 0.25
done
exit 1
