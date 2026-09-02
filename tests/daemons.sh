#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
SETTINGS_DIR="$TEST_ROOT/settings"
mkdir -p "$HOME" "$SETTINGS_DIR" "$TEST_ROOT/linuxbrew/bin"

MOCK_PLATFORM=linux
COMMAND_LOG="$TEST_ROOT/commands.log"
LINUXBREW_PREFIX="$TEST_ROOT/linuxbrew"

info() { :; }
success() { :; }
warn() { :; }
error() { :; }
has() { [[ "$1" == "visudo" ]]; }
_current_platform() { printf '%s\n' "$MOCK_PLATFORM"; }
_brew_shellenv_path() { printf '%s\n' "$LINUXBREW_PREFIX/bin/brew"; }
visudo() { /usr/bin/visudo "$@"; }
sudo() {
    printf '%s\n' "$*" >> "$COMMAND_LOG"
    case "$1" in
        /usr/bin/cmp)
            shift
            /usr/bin/cmp "$@"
            ;;
        /usr/bin/install)
            local -a args=("$@")
            local source_file="${args[-2]}"
            local target_file="${args[-1]}"
            cp "$source_file" "$target_file"
            chmod 0440 "$target_file"
            ;;
        *)
            echo "FAIL: unexpected sudo command: $*" >&2
            return 1
            ;;
    esac
}
cat > "$LINUXBREW_PREFIX/bin/brew" <<EOF
#!/usr/bin/env bash
printf '%s\\n' '$LINUXBREW_PREFIX'
EOF
chmod +x "$LINUXBREW_PREFIX/bin/brew"

# shellcheck disable=SC1091
source "$(dirname "$0")/../lib/daemons.sh"

LINUXBREW_SUDOERS_FILE="$TEST_ROOT/linuxbrew.sudoers"
_configure_linuxbrew_sudo

expected="Defaults secure_path=\"$LINUXBREW_PREFIX/bin:$LINUXBREW_PREFIX/sbin:/usr/local/sbin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/bin\""
[[ "$(<"$LINUXBREW_SUDOERS_FILE")" == "$expected" ]] || {
    echo "FAIL: Linuxbrew sudo secure_path is incorrect" >&2
    exit 1
}
[[ "$(stat -c '%a' "$LINUXBREW_SUDOERS_FILE")" == "440" ]] || {
    echo "FAIL: Linuxbrew sudoers file mode is not 0440" >&2
    exit 1
}

_configure_linuxbrew_sudo
[[ "$(grep -c '^/usr/bin/install ' "$COMMAND_LOG")" -eq 1 ]] || {
    echo "FAIL: unchanged Linuxbrew sudo configuration was reinstalled" >&2
    exit 1
}

MOCK_PLATFORM=darwin
: > "$COMMAND_LOG"
_configure_linuxbrew_sudo
[[ ! -s "$COMMAND_LOG" ]] || {
    echo "FAIL: macOS attempted to install Linuxbrew sudo configuration" >&2
    exit 1
}

# shellcheck disable=SC2016
grep -Fq 'sudo --preserve-env=HOME,XDG_CACHE_HOME "$(command -v brew)" services start tailscale' \
    "$(dirname "$0")/../scripts/services/tailscale.sh" || {
    echo "FAIL: Tailscale service start does not preserve the Homebrew cache environment" >&2
    exit 1
}

printf 'PASS: Linuxbrew sudo configuration\n'
