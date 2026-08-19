#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
SETTINGS_DIR="$TEST_ROOT/settings"
AUTOMOUNT_MASTER_FILE="$TEST_ROOT/etc/auto_master"
AUTOMOUNT_MAP_FILE="$TEST_ROOT/etc/auto_nas"
mkdir -p "$HOME" "$SETTINGS_DIR" "$TEST_ROOT/etc"

cat > "$SETTINGS_DIR/automounts.json" <<'JSON'
{
  "shares": {
    "NAS": "://guest:@nas.home.arpa/personal"
  }
}
JSON

cat > "$TEST_ROOT/etc/auto_standalone_nas" <<'EOF_MAP'
/Volumes/personal -fstype=smbfs,soft ://guest:@nas.home.arpa/personal
EOF_MAP
cat > "$TEST_ROOT/etc/auto_nfs" <<'EOF_MAP'
/net/storage -fstype=nfs nas.home.arpa:/storage
EOF_MAP
cat > "$AUTOMOUNT_MAP_FILE" <<'EOF_MAP'
# dotfiles automount
/Volumes/personal -fstype=smbfs,soft ://guest:@nas.home.arpa/personal
EOF_MAP
cat > "$AUTOMOUNT_MASTER_FILE" <<EOF_MASTER
+auto_master
/- $TEST_ROOT/etc/auto_standalone_nas
/- $TEST_ROOT/etc/auto_nfs
/- $AUTOMOUNT_MAP_FILE -nosuid # dotfiles automount
EOF_MASTER

info() { :; }
success() { :; }
warn() { :; }
error() { printf 'ERROR: %s\n' "$1" >&2; }
_is_macos() { return 0; }

sudo() {
    local command_name="$1"
    shift

    case "$command_name" in
        install)
            local args=()
            while [[ $# -gt 0 ]]; do
                case "$1" in
                    -o|-g)
                        shift 2
                        ;;
                    *)
                        args+=("$1")
                        shift
                        ;;
                esac
            done
            command install "${args[@]}"
            ;;
        rm)
            command rm "$@"
            ;;
        automount)
            printf '%s\n' "$*" > "$TEST_ROOT/automount.log"
            ;;
        *)
            printf 'FAIL: unexpected sudo command: %s %s\n' "$command_name" "$*" >&2
            return 1
            ;;
    esac
}

# shellcheck disable=SC1091
source "$REPO_ROOT/lib/automount.sh"
cmd_automount apply

expected_map="# dotfiles automount
$HOME/NAS -fstype=smbfs,soft,rw,filemode=0777,dirmode=0777,nodev ://guest:@nas.home.arpa/personal"
if [[ "$(<"$AUTOMOUNT_MAP_FILE")" != "$expected_map" ]]; then
    printf 'FAIL: generated SMB map is not the configured home-directory mount\n' >&2
    exit 1
fi
if [[ -e "$TEST_ROOT/etc/auto_standalone_nas" ]]; then
    printf 'FAIL: unconfigured SMB automount map was not removed\n' >&2
    exit 1
fi
if grep -Fq "$TEST_ROOT/etc/auto_standalone_nas" "$AUTOMOUNT_MASTER_FILE"; then
    printf 'FAIL: unconfigured SMB automount master entry was not removed\n' >&2
    exit 1
fi
if ! grep -Fq "/- $TEST_ROOT/etc/auto_nfs" "$AUTOMOUNT_MASTER_FILE"; then
    printf 'FAIL: unrelated NFS automount was removed\n' >&2
    exit 1
fi
if [[ "$(grep -Fc "$AUTOMOUNT_MAP_FILE" "$AUTOMOUNT_MASTER_FILE")" -ne 1 ]]; then
    printf 'FAIL: dotfiles SMB map must have exactly one master entry\n' >&2
    exit 1
fi
if [[ "$(<"$TEST_ROOT/automount.log")" != "-vc" ]]; then
    printf 'FAIL: automount configuration was not reloaded\n' >&2
    exit 1
fi

printf 'PASS: SMB automounts match dotfiles configuration\n'
