#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export DOTFILES_DIR="$REPO_ROOT"
export HOME="$TEST_ROOT/home"
mkdir -p "$HOME/.docker"
printf '{"changedBy":"docker"}\n' > "$HOME/.docker/config.json"
printf 'keep\n' > "$HOME/.docker/daemon.json"

"$REPO_ROOT/dot" stow >/dev/null 2>&1

[ -L "$HOME/.docker/config.json" ] || {
    printf 'FAIL: Docker config was not replaced with a symlink\n' >&2
    exit 1
}
[ "$(realpath "$HOME/.docker/config.json")" = "$REPO_ROOT/home/.docker/config.json" ] || {
    printf 'FAIL: Docker config symlink has the wrong target\n' >&2
    exit 1
}
[ "$(cat "$HOME/.docker/daemon.json")" = "keep" ] || {
    printf 'FAIL: stow changed unrelated Docker state\n' >&2
    exit 1
}

printf 'PASS: dot stow replaces Docker config and preserves Docker state\n'
