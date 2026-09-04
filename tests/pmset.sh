#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

SETTINGS_DIR="$TEST_ROOT/settings"
mkdir -p "$SETTINGS_DIR"
printf '%s\n' '{"displaysleep":60}' > "$SETTINGS_DIR/pmset.json"
COMMAND_LOG="$TEST_ROOT/commands.log"

info() { :; }
success() { :; }
warn() { :; }
error() { :; }
pmset() {
    if [[ $* == '-g custom' ]]; then
        cat <<EOF
Battery Power:
 displaysleep         20
AC Power:
 displaysleep         ${AC_DISPLAY_SLEEP:-60}
EOF
    elif [[ $* == '-g' ]]; then
        cat <<EOF
System-wide power settings:
Currently in use:
 displaysleep         20
EOF
    fi
}
sudo() { printf '%s\n' "$*" >> "$COMMAND_LOG"; }

# shellcheck disable=SC1091
source "$(dirname "$0")/../lib/settings.sh"

cmd_pmset apply
[[ ! -s $COMMAND_LOG ]] || {
    echo "FAIL: matching AC power settings were applied again" >&2
    exit 1
}

AC_DISPLAY_SLEEP=30
cmd_pmset apply
grep -Fqx 'pmset -c displaysleep 60' "$COMMAND_LOG" || {
    echo "FAIL: a mismatched AC power setting was not applied" >&2
    exit 1
}

printf 'PASS: pmset AC profile comparison\n'
