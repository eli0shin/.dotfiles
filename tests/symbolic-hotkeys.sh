#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Darwin ]]; then
    printf 'SKIP: symbolic hotkeys require macOS plutil\n'
    exit 0
fi

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
SETTINGS_DIR="$TEST_ROOT/settings"
mkdir -p "$SETTINGS_DIR"
COMMAND_LOG="$TEST_ROOT/commands.log"
PLIST="$TEST_ROOT/system.plist"

info() { :; }
success() { :; }
warn() { :; }
error() { :; }
# shellcheck disable=SC1091
source "$REPO_DIR/lib/settings.sh"

# Exercise native plist editing without touching live preferences or shortcuts.
defaults() {
    case "$1" in
        export) cp "$PLIST" "$3" ;;
        import)
            plutil -lint "$3" >/dev/null
            cp "$3" "$PLIST"
            printf 'import\n' >> "$COMMAND_LOG"
            ;;
        *) return 1 ;;
    esac
}
_activate_symbolic_hotkeys() { printf 'activate\n' >> "$COMMAND_LOG"; }

printf '%s\n' '{"AppleSymbolicHotKeys":{"28":{"enabled":true},"99":{"enabled":false,"value":{"parameters":[97,0,0],"type":"standard"}}}}' > "$PLIST"
plutil -convert xml1 "$PLIST"
printf '%s\n' '{"disabled":[28],"remapped":{"27":{"parameters":[96,50,1835008],"type":"standard"}}}' > "$SYMBOLIC_HOTKEYS_FILE"

_apply_symbolic_hotkeys
[[ $(plutil -extract AppleSymbolicHotKeys.28.enabled raw -o - "$PLIST") == false ]]
[[ $(plutil -extract AppleSymbolicHotKeys.27.enabled raw -o - "$PLIST") == true ]]
[[ $(plutil -extract AppleSymbolicHotKeys.27.value json -o - "$PLIST" | jq -cS .) == '{"parameters":[96,50,1835008],"type":"standard"}' ]]
[[ $(plutil -extract AppleSymbolicHotKeys.99 json -o - "$PLIST" | jq -cS .) == '{"enabled":false,"value":{"parameters":[97,0,0],"type":"standard"}}' ]]

# Identical settings do not rewrite preferences, but still activate the registry.
cp "$PLIST" "$TEST_ROOT/expected.plist"
_apply_symbolic_hotkeys
cmp "$PLIST" "$TEST_ROOT/expected.plist"
[[ $(grep -c '^import$' "$COMMAND_LOG") -eq 1 ]]
[[ $(grep -c '^activate$' "$COMMAND_LOG") -eq 2 ]]

# Existing mappings are replaced, including re-enabling a disabled binding.
plutil -replace AppleSymbolicHotKeys.27 -json '{"enabled":false,"value":{"parameters":[96,50,1048576],"type":"standard"}}' "$PLIST"
_apply_symbolic_hotkeys
[[ $(plutil -extract AppleSymbolicHotKeys.27.enabled raw -o - "$PLIST") == true ]]
[[ $(plutil -extract AppleSymbolicHotKeys.27.value.parameters json -o - "$PLIST" | jq -c .) == '[96,50,1835008]' ]]

# Older disable-only files remain supported and leave other bindings alone.
printf '%s\n' '{"disabled":[99]}' > "$SYMBOLIC_HOTKEYS_FILE"
_apply_symbolic_hotkeys
[[ $(plutil -extract AppleSymbolicHotKeys.27.value.parameters json -o - "$PLIST" | jq -c .) == '[96,50,1835008]' ]]
printf 'PASS: symbolic hotkey remapping, preservation, idempotence, and legacy settings\n'
