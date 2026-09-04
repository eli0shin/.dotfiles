#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export DOTFILES_DIR="$REPO_ROOT"

HELPER_SRC="$REPO_ROOT/home/bin/askpass"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

# --- 1. Helper script refuses to run outside macOS ---

if [ "$(uname -s)" != "Darwin" ]; then
    # Only safe to execute the helper on non-Darwin; on a Mac it would
    # open a real dialog.
    if "$HELPER_SRC" </dev/null >/dev/null 2>&1; then
        fail "askpass helper should exit nonzero on non-macOS"
    fi
    pass "askpass helper exits nonzero on non-macOS"
fi

# --- 2. Convergence of the sudo.conf line ---

# Isolate from the real machine: temp HOME, temp sudo.conf, and a sudo
# stub that runs commands directly. The stub also bridges the BSD/GNU
# sed difference: the lib uses `sed -i ''` (BSD form), which the stub
# collapses to plain `sed -i` for GNU sed.
export HOME="$TEST_ROOT/home"
export DOT_SUDO_CONF="$TEST_ROOT/sudo.conf"
mkdir -p "$HOME/bin" "$TEST_ROOT/stub"
cp "$HELPER_SRC" "$HOME/bin/askpass"
chmod +x "$HOME/bin/askpass"

cat > "$TEST_ROOT/stub/sudo" <<'STUB'
#!/usr/bin/env bash
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

printf 'PASS: sudo askpass setup is idempotent and safe\n'
