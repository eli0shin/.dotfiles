#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
COMMAND_LOG="$TEST_ROOT/commands.log"

# Linux Tailscale starts Homebrew with the required user cache environment.
# shellcheck disable=SC2016
grep -Fq 'sudo --preserve-env=HOME,XDG_CACHE_HOME "$(command -v brew)" services start tailscale' \
    "$(dirname "$0")/../scripts/services/tailscale.sh" || {
    echo "FAIL: Tailscale service start does not preserve the Homebrew cache environment" >&2
    exit 1
}

# A converged Linux service setup must not invoke sudo.
mkdir -p "$TEST_ROOT/stub"
cat > "$TEST_ROOT/stub/uname" <<'STUB'
#!/usr/bin/env bash
printf 'Linux\n'
STUB
cat > "$TEST_ROOT/stub/systemctl" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == "is-active" ]]
STUB
cat > "$TEST_ROOT/stub/sudo" <<STUB
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$COMMAND_LOG"
STUB
cat > "$TEST_ROOT/tailscale-lan" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == "check-install" ]]
STUB
chmod +x "$TEST_ROOT/stub/"* "$TEST_ROOT/tailscale-lan"

# An unsafe root-executed helper is drift, even when its contents match.
cp "$(dirname "$0")/../scripts/services/tailscale-lan.sh" "$TEST_ROOT/unsafe-tailscale-lan"
chmod 0777 "$TEST_ROOT/unsafe-tailscale-lan"
if TAILSCALE_LAN_INSTALLED_SCRIPT="$TEST_ROOT/unsafe-tailscale-lan" \
    /bin/bash "$(dirname "$0")/../scripts/services/tailscale-lan.sh" check-install; then
    echo "FAIL: unsafe Tailscale helper mode was accepted" >&2
    exit 1
fi

TAILSCALE_LAN_SCRIPT="$TEST_ROOT/tailscale-lan" \
    PATH="$TEST_ROOT/stub:$PATH" bash "$(dirname "$0")/../scripts/services/tailscale.sh"
[[ ! -s "$COMMAND_LOG" ]] || {
    echo "FAIL: converged Tailscale setup triggered sudo" >&2
    exit 1
}

! rg -q '_configure_linuxbrew_sudo|LINUXBREW_SUDOERS_FILE|sudo /usr/bin/cmp' \
    "$(dirname "$0")/../lib/daemons.sh" || {
    echo "FAIL: normal service setup still configures Linuxbrew sudo" >&2
    exit 1
}

printf 'PASS: converged service setup does not use sudo\n'
