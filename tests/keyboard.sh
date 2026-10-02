#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
export HOME="$TEST_ROOT/home"
export XDG_CONFIG_HOME="$HOME/.config"
export OMARCHY_PATH="$TEST_ROOT/omarchy"
export HYPRLAND_INSTANCE_SIGNATURE=test
mkdir -p "$XDG_CONFIG_HOME/hypr" "$OMARCHY_PATH" "$TEST_ROOT/settings"

# shellcheck source=../lib/common.sh
source "$REPO_DIR/lib/common.sh"
# shellcheck disable=SC2034 # Used by the sourced settings module.
SETTINGS_DIR="$TEST_ROOT/settings"
# shellcheck source=../lib/settings.sh
source "$REPO_DIR/lib/settings.sh"
info() { :; }
success() { :; }
warn() { :; }
error() { :; }
PLATFORM=Linux
uname() { printf '%s\n' "$PLATFORM"; }
COMMAND_LOG="$TEST_ROOT/commands.log"
CONFIG_ERRORS=""
hyprctl() {
    printf '%s\n' "$*" >> "$COMMAND_LOG"
    case "$1" in
        configerrors) printf '%s' "$CONFIG_ERRORS" ;;
        getoption) printf 'str: caps:escape,ctrl:ralt_rctrl\n' ;;
    esac
}
hidutil() { printf '%s\n' "$*" >> "$COMMAND_LOG"; }

cp "$REPO_DIR/settings/keyboard.base.json" "$KEYBOARD_FILE"
printf '%s\n' '-- Personal settings must survive.' > "$XDG_CONFIG_HOME/hypr/hyprland.lua"
cmd_keyboard apply
MANAGED_CONFIG="$XDG_CONFIG_HOME/hypr/dot-keyboard.lua"
[[ -f "$MANAGED_CONFIG" ]]
grep -qF -- '-- Personal settings must survive.' "$XDG_CONFIG_HOME/hypr/hyprland.lua"
grep -qFx 'reload' "$COMMAND_LOG"
grep -qFx 'configerrors' "$COMMAND_LOG"
[[ $(find "$XDG_CONFIG_HOME/hypr" -name 'hyprland.lua.bak.*' | wc -l) -eq 1 ]]

# Repeated application neither duplicates the hook nor changes the module.
cp "$MANAGED_CONFIG" "$TEST_ROOT/expected.lua"
cmd_keyboard apply
cmp "$MANAGED_CONFIG" "$TEST_ROOT/expected.lua"
[[ $(grep -c 'managed by dot keyboard' "$XDG_CONFIG_HOME/hypr/hyprland.lua") -eq 1 ]]

# Execute the actual generated Lua with Hyprland's API stubbed. This checks
# merging, conflicting Compose removal, and new defaults on later reloads.
lua - "$MANAGED_CONFIG" <<'LUA'
local module = arg[1]
local current, applied
hl = {
  get_config = function(key)
    assert(key == "input.kb_options")
    return current
  end,
  config = function(config) applied = config.input.kb_options end,
}
current = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle,compose:ralt,lv3:ralt_switch,lv5:ralt_switch"
dofile(module)
assert(applied == "shift:both_capslock_cancel,grp:alts_toggle,caps:escape,ctrl:ralt_rctrl", applied)
current = applied
dofile(module)
assert(applied == current, "reapplying must not duplicate options")
current = "compose:caps,grp:win_space_toggle"
dofile(module)
assert(applied == "grp:win_space_toggle,caps:escape,ctrl:ralt_rctrl", applied)
LUA

cmd_keyboard show
# Unsupported remaps must fail before modifying either config file.
cp "$XDG_CONFIG_HOME/hypr/hyprland.lua" "$TEST_ROOT/main.lua"
printf '%s\n' '{"remaps":[{"from":"escape","to":"left_command"}]}' > "$KEYBOARD_FILE"
if cmd_keyboard apply 2>/dev/null; then
    echo 'FAIL: unsupported remap accepted' >&2
    exit 1
fi
cmp "$MANAGED_CONFIG" "$TEST_ROOT/expected.lua"
cmp "$XDG_CONFIG_HOME/hypr/hyprland.lua" "$TEST_ROOT/main.lua"

# Empty configuration removes dot's overrides on the next reload.
printf '%s\n' '{"remaps":[]}' > "$KEYBOARD_FILE"
cmd_keyboard apply
lua - "$MANAGED_CONFIG" <<'LUA'
hl = {
  get_config = function() return "compose:caps,grp:alts_toggle" end,
  config = function(config)
    assert(config.input.kb_options == "compose:caps,grp:alts_toggle")
  end,
}
dofile(arg[1])
LUA

# Offline setup persists the module without calling hyprctl.
cp "$REPO_DIR/settings/keyboard.base.json" "$KEYBOARD_FILE"
unset HYPRLAND_INSTANCE_SIGNATURE
: > "$COMMAND_LOG"
cmd_keyboard apply
[[ ! -s "$COMMAND_LOG" ]]

# Live validation errors propagate to the caller.
export HYPRLAND_INSTANCE_SIGNATURE=test
CONFIG_ERRORS='broken config'
if cmd_keyboard apply; then
    echo 'FAIL: configerrors did not fail application' >&2
    exit 1
fi
CONFIG_ERRORS=""

# macOS continues to use HID mappings, including Right Option -> Right Control.
PLATFORM=Darwin
: > "$COMMAND_LOG"
cmd_keyboard apply
grep -qF '"HIDKeyboardModifierMappingSrc":0x700000039,"HIDKeyboardModifierMappingDst":0x700000029' "$COMMAND_LOG"
grep -qF '"HIDKeyboardModifierMappingSrc":0x7000000E6,"HIDKeyboardModifierMappingDst":0x7000000E4' "$COMMAND_LOG"
! grep -qFx 'reload' "$COMMAND_LOG"
cmd_keyboard show

# Other Linux distributions must not run hidutil or mutate Hyprland config.
PLATFORM=Linux
export OMARCHY_PATH="$TEST_ROOT/not-omarchy"
: > "$COMMAND_LOG"
cmd_keyboard apply
cmd_keyboard show
[[ ! -s "$COMMAND_LOG" ]]
if cmd_keyboard invalid; then
    echo 'FAIL: invalid subcommand accepted' >&2
    exit 1
fi
printf 'PASS: keyboard platform dispatch, persistence, XKB merging, and validation\n'
