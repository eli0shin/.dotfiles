#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export DOTFILES_DIR="$REPO_ROOT"

HELPER_SRC="$REPO_ROOT/home/bin/askpass"
SUDO_WRAPPER="$REPO_ROOT/home/bin/sudo"
SYSTEM_NAME=$(uname -s)

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

# --- 1. Helper script refuses to run outside macOS ---

if [ "$SYSTEM_NAME" != "Darwin" ]; then
    # Only safe to execute the helper on non-Darwin; on a Mac it would
    # open a real dialog.
    if "$HELPER_SRC" </dev/null >/dev/null 2>&1; then
        fail "askpass helper should exit nonzero on non-macOS"
    fi
    pass "askpass helper exits nonzero on non-macOS"
fi

# --- 2. Convergence of the sudo.conf line ---

# Isolate from the real machine: temp HOME, temp sudo.conf, and a sudo
# stub that runs commands directly. On Linux, the stub also bridges the
# BSD/GNU sed difference: the lib uses `sed -i ''` (BSD form), which the
# stub collapses to plain `sed -i` for GNU sed.
export HOME="$TEST_ROOT/home"
export DOT_SUDO_CONF="$TEST_ROOT/sudo.conf"
mkdir -p "$HOME/bin" "$TEST_ROOT/stub"
cp "$HELPER_SRC" "$HOME/bin/askpass"
chmod +x "$HOME/bin/askpass"

cat > "$TEST_ROOT/stub/sudo" <<'STUB'
#!/usr/bin/env bash
if [ "$(uname -s)" = "Darwin" ]; then
    exec "$@"
fi
if [ "${1:-}" = "sed" ]; then
    shift
    if [ "${1:-}" = "-i" ] && [ -z "${2-}" ]; then
        shift 2
        exec sed -i "$@"
    fi
fi
exec "$@"
STUB
chmod +x "$TEST_ROOT/stub/sudo"
export PATH="$TEST_ROOT/stub:$PATH"

source "$REPO_ROOT/lib/common.sh"
source "$REPO_ROOT/lib/askpass.sh"

_is_macos() { return 0; }   # force the macOS code path for the test

line_count() { grep -cFx "$ASKPASS_LINE" "$SUDO_CONF" || true; }

# First apply: appends the line.
_askpass_apply >/dev/null 2>&1
[ "$(line_count)" = "1" ] || fail "first apply should add exactly one askpass line"
pass "apply appends the askpass line"

# Second apply: idempotent, no duplicate.
_askpass_apply >/dev/null 2>&1
[ "$(line_count)" = "1" ] || fail "repeated apply should not duplicate the line"
pass "repeated apply is idempotent"

# Wrong value: repaired in place, not appended next to.
printf 'Path askpass /old/askpass\n' > "$SUDO_CONF"
_askpass_apply >/dev/null 2>&1
[ "$(line_count)" = "1" ] || fail "apply should fix a wrong path, not append"
grep -qsFx "$ASKPASS_LINE" "$SUDO_CONF" || fail "wrong path was not replaced"
pass "apply repairs an outdated askpass path"

# Commented template line only: must not count as configured.
printf '# sudo.conf\n#Path askpass /usr/X11R6/bin/ssh-askpass\n' > "$SUDO_CONF"
_askpass_apply >/dev/null 2>&1
[ "$(line_count)" = "1" ] || fail "commented template line should not satisfy the check"
pass "commented template line does not block installation"

# Helper missing: apply must refuse to write the line.
printf '' > "$SUDO_CONF"
mv "$HOME/bin/askpass" "$TEST_ROOT/askpass.bak"
if _askpass_apply >/dev/null 2>&1; then
    fail "apply should fail when the helper is missing"
fi
[ -s "$SUDO_CONF" ] && fail "apply must not write the line without the helper"
pass "apply refuses to configure without the helper"
mv "$TEST_ROOT/askpass.bak" "$HOME/bin/askpass"

# --- 3. sudo wrapper selects askpass without a terminal ---

cat > "$TEST_ROOT/system-sudo" <<'STUB'
#!/bin/sh
printf '%s\n' "$@"
STUB
cat > "$TEST_ROOT/stub/uname" <<'STUB'
#!/bin/sh
printf 'Darwin\n'
STUB
chmod +x "$TEST_ROOT/system-sudo" "$TEST_ROOT/stub/uname"

output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" true)
[ "$output" = "$(printf '%s\n' -A true)" ] || fail "no-tty sudo should add -A"
pass "no-tty sudo selects askpass"

if [ "$SYSTEM_NAME" = "Darwin" ]; then
    # shellcheck disable=SC2016 # The child shell expands its positional parameters.
    output=$(script -q /dev/null sh -c 'DOT_SUDO_BIN="$1" "$2" true </dev/null' sh "$TEST_ROOT/system-sudo" "$SUDO_WRAPPER")
    printf '%s' "$output" | grep -q 'true' || fail "sudo with a controlling terminal should preserve its arguments"
    if printf '%s' "$output" | grep -q -- '-A'; then
        fail "sudo with a controlling terminal should not add -A"
    fi
    pass "controlling terminal keeps normal sudo prompting"
fi

output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" -S true)
[ "$output" = "$(printf '%s\n' -S true)" ] || fail "explicit -S should be preserved"
output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" --std true)
[ "$output" = "$(printf '%s\n' --std true)" ] || fail "abbreviated --stdin should be preserved"
pass "explicit sudo password input mode is preserved"

output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" -u root -Sk true)
[ "$output" = "$(printf '%s\n' -u root -Sk true)" ] || fail "combined -S option should be preserved"
pass "combined sudo password input mode is preserved"

output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" --chd /tmp -S true)
[ "$output" = "$(printf '%s\n' --chd /tmp -S true)" ] || fail "abbreviated value option should not hide -S"
output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" --chdir=/tmp -S true)
[ "$output" = "$(printf '%s\n' --chdir=/tmp -S true)" ] || fail "inline value option should not hide -S"
output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" --chd=/tmp -S true)
[ "$output" = "$(printf '%s\n' --chd=/tmp -S true)" ] || fail "abbreviated inline value option should not hide -S"
pass "sudo value options are parsed"

output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" FOO=bar -S true)
[ "$output" = "$(printf '%s\n' FOO=bar -S true)" ] || fail "-S after an environment assignment should be preserved"
output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" 1FOO=bar -A true)
[ "$output" = "$(printf '%s\n' 1FOO=bar -A true)" ] || fail "-A after a sudo-compatible environment assignment should be preserved"
pass "password input mode after a sudo environment assignment is preserved"

output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" -- printf '%s' -S)
[ "$output" = "$(printf '%s\n' -A -- printf '%s' -S)" ] || fail "command arguments should not be parsed as sudo options"
output=$(DOT_SUDO_BIN="$TEST_ROOT/system-sudo" "$SUDO_WRAPPER" /tmp/tool=debug -S)
[ "$output" = "$(printf '%s\n' -A /tmp/tool=debug -S)" ] || fail "absolute assignment-like command paths should stop option parsing"
pass "command arguments do not change sudo password input mode"

printf 'PASS: sudo askpass setup is idempotent and safe\n'
