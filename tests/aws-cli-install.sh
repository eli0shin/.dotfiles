#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
BREWFILE="$REPO_ROOT/packages/Brewfile"
BASH_PACKAGES="$REPO_ROOT/packages/bash-packages.json"

if [[ "$(grep -c '^brew "awscli"$' "$BREWFILE")" -ne 1 ]]; then
    echo 'FAIL: awscli must be managed once by Homebrew' >&2
    exit 1
fi

if jq -e 'any(.[]; .command == "aws")' "$BASH_PACKAGES" >/dev/null; then
    echo 'FAIL: aws must not use a custom installer that can require sudo' >&2
    exit 1
fi

printf 'PASS: AWS CLI uses the user-owned Homebrew installation\n'
