#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
PACKAGES_DIR="$TEST_ROOT/packages"
mkdir -p "$HOME/.bun/install/global" "$PACKAGES_DIR"

info() { :; }
success() { :; }
warn() { :; }
error() { :; }
has() { [[ "$1" == "bun" ]]; }

# shellcheck disable=SC1091
source "$(dirname "$0")/../lib/packages.sh"

assert_eq() {
    local expected="$1"
    local actual="$2"
    local message="$3"

    if [[ "$actual" != "$expected" ]]; then
        printf 'FAIL: %s\nexpected: %s\nactual:   %s\n' "$message" "$expected" "$actual" >&2
        exit 1
    fi
}

assert_eq "prettier" "$(_npm_package_name "prettier")" "plain package name"
assert_eq "prettier" "$(_npm_package_name "prettier@3.8.3")" "unscoped version"
assert_eq "prettier" "$(_npm_package_name "prettier@next")" "unscoped tag"
assert_eq "@opencode-ai/cli" "$(_npm_package_name "@opencode-ai/cli")" "scoped package name"
assert_eq "@opencode-ai/cli" "$(_npm_package_name "@opencode-ai/cli@next")" "scoped tag"
assert_eq "@opencode-ai/cli" "$(_npm_package_name "@opencode-ai/cli@1.2.3")" "scoped version"

cat > "$HOME/.bun/install/global/package.json" <<'JSON'
{"dependencies":{"@opencode-ai/cli":"0.0.0-next-17173","prettier":"^3.8.3"}}
JSON
printf '%s\n' '@opencode-ai/cli' > "$NPM_TRUSTED_PACKAGES_FILE"

_bun_global_package_exists "@opencode-ai/cli@next" || {
    echo "FAIL: tagged scoped package was not found in Bun's global manifest" >&2
    exit 1
}

BUN_LOG="$TEST_ROOT/bun.log"
bun() { printf '%s\n' "$*" >> "$BUN_LOG"; }

printf '%s\n' '@opencode-ai/cli@next' > "$NPM_PACKAGES_FILE"
_npm_package_exists '@opencode-ai/cli' "$NPM_PACKAGES_FILE" || {
    echo "FAIL: package specification was not found by its canonical name" >&2
    exit 1
}

_process_npm_packages_file "$NPM_PACKAGES_FILE"
assert_eq 'add -g --trust @opencode-ai/cli@next' "$(<"$BUN_LOG")" "tagged package is reconciled with its full specification"

: > "$BUN_LOG"
printf '%s\n' '@opencode-ai/cli' > "$NPM_PACKAGES_FILE"
_process_npm_packages_file "$NPM_PACKAGES_FILE"
assert_eq 'add -g --trust @opencode-ai/cli' "$(<"$BUN_LOG")" "installed allowlisted package becomes trusted"

: > "$BUN_LOG"
printf '%s\n' '@opencode-ai/cli@npm:prettier' > "$NPM_PACKAGES_FILE"
_process_npm_packages_file "$NPM_PACKAGES_FILE"
assert_eq 'add -g @opencode-ai/cli@npm:prettier' "$(<"$BUN_LOG")" "npm alias cannot inherit package trust"

: > "$BUN_LOG"
printf '%s\n' '@opencode-ai/cli@next' > "$NPM_PACKAGES_FILE"
_process_npm_packages_file "$NPM_PACKAGES_FILE" update
assert_eq 'add -g --trust @opencode-ai/cli@next' "$(<"$BUN_LOG")" "tagged package update keeps its specification"

: > "$BUN_LOG"
printf '%s\n' 'prettier' > "$NPM_PACKAGES_FILE"
_process_npm_packages_file "$NPM_PACKAGES_FILE" update
assert_eq 'update -g prettier' "$(<"$BUN_LOG")" "plain package update uses bun update"

: > "$BUN_LOG"
printf '%s\n' 'prettier@next' > "$NPM_PACKAGES_FILE"
_process_npm_packages_file "$NPM_PACKAGES_FILE"
assert_eq 'add -g prettier@next' "$(<"$BUN_LOG")" "untrusted package install does not enable lifecycle scripts"

: > "$BUN_LOG"
printf '%s\n' '@opencode-ai/cli@next' '@opencode-ai/cli@beta' > "$NPM_PACKAGES_FILE"
cmd_package remove '@opencode-ai/cli' --npm
assert_eq 'remove -g @opencode-ai/cli' "$(<"$BUN_LOG")" "tagged package is removed by package name"
assert_eq '' "$(<"$NPM_PACKAGES_FILE")" "all specifications for the package are removed from the package file"

printf 'PASS: npm package specifications\n'
