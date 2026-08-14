#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export DOTFILES_DIR="$REPO_ROOT"
export HOME="$TEST_ROOT/home"
mkdir -p "$HOME"

"$REPO_ROOT/dot" completions >/dev/null

generated="$HOME/.config/fish/completions/dot.fish"
committed="$REPO_ROOT/home/.config/fish/completions/dot.fish"

for completions in "$generated" "$committed"; do
    if grep -Eq '^complete -c dot .* -a "init"' "$completions"; then
        printf 'FAIL: %s offers the unsupported init command\n' "$completions" >&2
        exit 1
    fi
done

printf 'PASS: dot completions contain only supported setup commands\n'
