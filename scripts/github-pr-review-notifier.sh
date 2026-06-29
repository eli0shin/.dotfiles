#!/usr/bin/env bash
set -euo pipefail

QUERY='is:pr state:open -is:draft archived:false (user-review-requested:@me OR team-review-requested:fanatics-gaming/ffs-engineering) -author:@me'
REVIEWS_URL='https://github.com/pulls/reviews?q=is%3Apr+state%3Aopen+-is%3Adraft+archived%3Afalse+sort%3Aupdated-desc+%28user-review-requested%3A%40me+OR+team-review-requested%3Afanatics-gaming%2Fffs-engineering%29+-author%3A%40me'
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/github-pr-review-notifier"
STATE_FILE="$STATE_DIR/pr-ids.txt"
TMP_FILE="$STATE_DIR/pr-ids.current.txt"

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

command -v gh >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v terminal-notifier >/dev/null 2>&1 || exit 0

mkdir -p "$STATE_DIR"

if ! gh api -X GET search/issues \
  -f q="$QUERY" \
  -f sort=updated \
  -f order=desc \
  --paginate \
  --jq '.items[].node_id' \
  | sort -u > "$TMP_FILE"; then
  rm -f "$TMP_FILE"
  exit 0
fi

if [[ ! -f "$STATE_FILE" ]]; then
  mv "$TMP_FILE" "$STATE_FILE"
  exit 0
fi

new_count=$(comm -13 <(sort -u "$STATE_FILE") "$TMP_FILE" | wc -l | tr -d '[:space:]')
mv "$TMP_FILE" "$STATE_FILE"

if [[ "$new_count" -gt 0 ]]; then
  if [[ "$new_count" -eq 1 ]]; then
    message="1 new PR requires your review"
  else
    message="$new_count new PRs require your review"
  fi

  terminal-notifier \
    -title "GitHub Reviews" \
    -message "$message" \
    -group "com.dotfiles.github-pr-review-notifier" \
    -open "$REVIEWS_URL" >/dev/null 2>&1 || true
fi
