# shellcheck shell=bash
# Machine settings and login shell configuration.

PMSET_FILE="$SETTINGS_DIR/pmset.json"
DEFAULTS_FILE="$SETTINGS_DIR/defaults.json"
KEYBOARD_FILE="$SETTINGS_DIR/keyboard.json"
SYMBOLIC_HOTKEYS_FILE="$SETTINGS_DIR/symbolic-hotkeys.json"

_pmset_ac_value() {
    local custom_settings="$1"
    local key="$2"

    awk -v key="$key" '
        /^AC Power:$/ { in_ac = 1; next }
        /^[^[:space:]].*:$/ { in_ac = 0 }
        in_ac && $1 == key { print $2; exit }
    ' <<< "$custom_settings"
}

cmd_pmset() {
    local subcmd="${1:-apply}"

    case "$subcmd" in
        apply)
            if [[ ! -f "$PMSET_FILE" ]]; then
                warn "No pmset.json found"
                return 0
            fi

            local settings
            settings=$(jq -r 'to_entries[] | "\(.key) \(.value)"' "$PMSET_FILE")

            if [[ -z "$settings" ]]; then
                return 0
            fi

            info "Checking pmset settings..."

            local custom_settings
            custom_settings=$(pmset -g custom)
            local needs_change=false

            while IFS= read -r line; do
                local key value current
                key=$(echo "$line" | awk '{print $1}')
                value=$(echo "$line" | awk '{print $2}')
                current=$(_pmset_ac_value "$custom_settings" "$key")

                if [[ "$current" == "$value" ]]; then
                    success "$key already set to $value"
                else
                    needs_change=true
                    info "Setting $key=$value (was $current)"
                    if sudo pmset -c "$key" "$value"; then
                        success "Set $key=$value"
                    else
                        warn "Failed to set $key=$value"
                    fi
                fi
            done <<< "$settings"

            if [[ "$needs_change" == false ]]; then
                success "All pmset settings already correct"
            else
                success "pmset settings applied"
            fi
            ;;
        show)
            echo -e "${BLUE}=== Current pmset Settings ===${NC}"
            pmset -g
            echo ""
            if [[ -f "$PMSET_FILE" ]]; then
                echo -e "${BLUE}=== Configured Settings (settings/pmset.json) ===${NC}"
                jq '.' "$PMSET_FILE"
            fi
            ;;
        *)
            error "Usage: dot pmset [apply|show]"
            return 1
            ;;
    esac
}

# =============================================================================
# Defaults Helpers
# =============================================================================

# Map domains to apps that need restarting
_defaults_read() {
    gtimeout 3 defaults read "$1" "$2" 2>/dev/null
}

_defaults_write() {
    gtimeout 3 defaults write "$@" 2>/dev/null
}

_defaults_read_object() {
    gtimeout 3 defaults export "$1" - 2>/dev/null \
        | plutil -extract "$2" json -o - - 2>/dev/null \
        | jq -cS '.' 2>/dev/null
}

_defaults_write_object() {
    local domain="$1"
    local key="$2"
    local value="$3"
    local args=()
    local entry

    while IFS= read -r entry; do
        local entry_key entry_type entry_value
        entry_key=$(jq -r '.key' <<< "$entry")
        entry_type=$(jq -r '.value | type' <<< "$entry")
        entry_value=$(jq -r '.value' <<< "$entry")

        case "$entry_type" in
            string)
                args+=("$entry_key" "$entry_value")
                ;;
            boolean)
                args+=("$entry_key" -bool "$entry_value")
                ;;
            number)
                if [[ "$entry_value" =~ ^-?[0-9]+$ ]]; then
                    args+=("$entry_key" -int "$entry_value")
                else
                    args+=("$entry_key" -float "$entry_value")
                fi
                ;;
            *)
                warn "Unsupported nested defaults value: $domain $key.$entry_key"
                return 1
                ;;
        esac
    done < <(jq -c 'to_entries[]' <<< "$value")

    _defaults_write "$domain" "$key" -dict "${args[@]}"
}

_apply_symbolic_hotkeys() {
    if [[ "$(uname -s)" != "Darwin" || ! -f "$SYMBOLIC_HOTKEYS_FILE" ]]; then
        return 0
    fi

    local plist
    plist=$(mktemp)
    if ! defaults export com.apple.symbolichotkeys "$plist" 2>/dev/null; then
        rm -f "$plist"
        error "Failed to read macOS symbolic hotkeys"
        return 1
    fi

    local changed=false
    local hotkey_id
    while IFS= read -r hotkey_id; do
        local path="AppleSymbolicHotKeys.$hotkey_id.enabled"
        local enabled
        enabled=$(plutil -extract "$path" raw -o - "$plist" 2>/dev/null || true)

        if [[ "$enabled" == "false" ]]; then
            continue
        fi

        if [[ -n "$enabled" ]]; then
            plutil -replace "$path" -bool false "$plist"
        elif plutil -extract "AppleSymbolicHotKeys.$hotkey_id" json -o - "$plist" >/dev/null 2>&1; then
            plutil -insert "$path" -bool false "$plist"
        else
            plutil -insert "AppleSymbolicHotKeys.$hotkey_id" -json '{"enabled":false}' "$plist"
        fi
        changed=true
    done < <(jq -r '.disabled[]' "$SYMBOLIC_HOTKEYS_FILE")

    if [[ "$changed" == true ]]; then
        info "Disabling conflicting macOS shortcuts..."
        if ! defaults import com.apple.symbolichotkeys "$plist" 2>/dev/null; then
            rm -f "$plist"
            error "Failed to update macOS symbolic hotkeys"
            return 1
        fi
    fi

    # Writing the plist does not update the live system hotkey registry.
    # activateSettings is the macOS mechanism that applies symbolic hotkeys
    # without a logout or restart.
    local activate_settings="/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings"
    defaults read com.apple.symbolichotkeys.plist >/dev/null 2>&1 || true
    if [[ -x "$activate_settings" ]]; then
        if ! "$activate_settings" -u; then
            rm -f "$plist"
            error "Failed to activate macOS symbolic hotkeys"
            return 1
        fi
    else
        killall SystemUIServer 2>/dev/null || true
    fi

    if [[ "$changed" == true ]]; then
        success "Disabled conflicting macOS shortcuts"
    fi

    rm -f "$plist"
}

_get_app_for_domain() {
    case "$1" in
        com.apple.finder) echo "Finder" ;;
        com.apple.dock|com.apple.WindowManager) echo "Dock" ;;
        com.apple.SystemUIServer|com.apple.desktopsettings.menubar) echo "SystemUIServer" ;;
        com.apple.screencapture) echo "SystemUIServer" ;;
        com.apple.menuextra.clock) echo "SystemUIServer" ;;
        *) echo "" ;;
    esac
}

cmd_defaults() {
    local subcmd="${1:-apply}"

    case "$subcmd" in
        apply)
            if [[ ! -f "$DEFAULTS_FILE" ]]; then
                warn "No defaults.json found"
                return 0
            fi

            info "Checking macOS defaults..."

            local needs_change=false
            local apps_to_restart=()

            # Iterate over each domain
            local domains
            domains=$(jq -r 'keys[]' "$DEFAULTS_FILE")

            while IFS= read -r domain; do
                # Iterate over each key in the domain
                local keys
                keys=$(jq -r --arg d "$domain" '.[$d] | keys[]' "$DEFAULTS_FILE")

                while IFS= read -r key; do
                    local value value_type current
                    value=$(jq -r --arg d "$domain" --arg k "$key" '.[$d][$k]' "$DEFAULTS_FILE")
                    value_type=$(jq -r --arg d "$domain" --arg k "$key" '.[$d][$k] | type' "$DEFAULTS_FILE")

                    # Get current value (with timeout to handle corrupt containers)
                    local read_succeeded=true
                    if [[ "$value_type" == "object" ]]; then
                        current=$(_defaults_read_object "$domain" "$key") || read_succeeded=false
                    else
                        current=$(_defaults_read "$domain" "$key") || read_succeeded=false
                    fi
                    if [[ "$read_succeeded" == false || -z "$current" ]]; then
                        current="__NOT_SET__"
                    fi

                    # Convert JSON values to a stable defaults representation.
                    local expected="$value"
                    if [[ "$value_type" == "boolean" ]]; then
                        [[ "$value" == "true" ]] && expected="1" || expected="0"
                    elif [[ "$value_type" == "object" ]]; then
                        expected=$(jq -cS '.' <<< "$value")
                    fi

                    if [[ "$current" == "$expected" ]]; then
                        success "$domain $key already set to $expected"
                    else
                        needs_change=true
                        info "Setting $domain $key=$expected (was $current)"

                        # Write the value with appropriate type
                        case "$value_type" in
                            boolean)
                                _defaults_write "$domain" "$key" -bool "$value"
                                ;;
                            number)
                                # Check if it's an integer or float
                                if [[ "$value" =~ ^-?[0-9]+$ ]]; then
                                    _defaults_write "$domain" "$key" -int "$value"
                                else
                                    _defaults_write "$domain" "$key" -float "$value"
                                fi
                                ;;
                            object)
                                _defaults_write_object "$domain" "$key" "$value"
                                ;;
                            *)
                                _defaults_write "$domain" "$key" -string "$value"
                                ;;
                        esac

                        success "Set $domain $key=$expected"

                        # Track app to restart
                        local app
                        app=$(_get_app_for_domain "$domain")
                        if [[ -n "$app" ]] && [[ ! " ${apps_to_restart[*]} " =~ " $app " ]]; then
                            apps_to_restart+=("$app")
                        fi
                    fi
                done <<< "$keys"
            done <<< "$domains"

            _apply_symbolic_hotkeys || return 1
            _apply_default_editor || return 1

            # Restart affected apps
            if [[ ${#apps_to_restart[@]} -gt 0 ]]; then
                info "Restarting affected apps: ${apps_to_restart[*]}"
                for app in "${apps_to_restart[@]}"; do
                    killall "$app" 2>/dev/null || true
                done
            fi

            if [[ "$needs_change" == false ]]; then
                success "All macOS defaults already correct"
            else
                success "macOS defaults applied"
            fi
            ;;
        show)
            echo -e "${BLUE}=== Configured Defaults (settings/defaults.json) ===${NC}"
            if [[ -f "$DEFAULTS_FILE" ]]; then
                jq '.' "$DEFAULTS_FILE"
            else
                echo "(no config file)"
            fi
            _show_default_editor
            ;;
        *)
            error "Usage: dot defaults [apply|show]"
            return 1
            ;;
    esac
}

# =============================================================================
# Keyboard Helpers
# =============================================================================

# Map key names to HID usage codes
_get_hid_code() {
    case "$1" in
        caps_lock) echo "0x700000039" ;;
        escape) echo "0x700000029" ;;
        control) echo "0x7000000E0" ;;
        left_control) echo "0x7000000E0" ;;
        right_control) echo "0x7000000E4" ;;
        left_shift) echo "0x7000000E1" ;;
        right_shift) echo "0x7000000E5" ;;
        left_option) echo "0x7000000E2" ;;
        right_option) echo "0x7000000E6" ;;
        left_command) echo "0x7000000E3" ;;
        right_command) echo "0x7000000E7" ;;
        *) echo "" ;;
    esac
}

# Omarchy's Lua config loads this module after its defaults and user overrides.
# Merge at config-load time so layout switching and other XKB options survive.
_keyboard_omarchy() {
    local subcmd="$1"
    local hypr_dir="${XDG_CONFIG_HOME:-$HOME/.config}/hypr"
    local main_config="$hypr_dir/hyprland.lua"
    local managed_config="$hypr_dir/dot-keyboard.lua"
    local hook='require("hypr.dot-keyboard") -- managed by dot keyboard'

    case "$subcmd" in
        apply)
            if [[ ! -f "$KEYBOARD_FILE" ]]; then
                warn "No keyboard.json found"
                return 0
            fi
            if [[ ! -f "$main_config" ]]; then
                error "dot keyboard requires Omarchy's Lua Hyprland config"
                return 1
            fi
            if [[ -e "$managed_config" ]] && ! grep -qFx -- '-- Generated by dot keyboard. Do not edit.' "$managed_config"; then
                error "Refusing to overwrite unmanaged $managed_config"
                return 1
            fi

            # XKB has named options rather than arbitrary HID remaps. Reject
            # unsupported pairs before changing any configuration.
            local remaps
            if ! remaps=$(jq -ce '
                .remaps | map(
                    if .from == "caps_lock" and .to == "escape" then "caps:escape"
                    elif .from == "right_option" and .to == "right_control" then "ctrl:ralt_rctrl"
                    else error("Unsupported Omarchy remap: \(.from) -> \(.to)")
                    end
                ) | unique
            ' "$KEYBOARD_FILE"); then
                error "Keyboard remappings could not be translated to XKB options"
                return 1
            fi

            local remap_caps remap_right_alt
            remap_caps=$(jq 'index("caps:escape") != null' <<< "$remaps")
            remap_right_alt=$(jq 'index("ctrl:ralt_rctrl") != null' <<< "$remaps")
            {
                printf '%s\n' '-- Generated by dot keyboard. Do not edit.'
                printf 'local remap_caps = %s\nlocal remap_right_alt = %s\n' "$remap_caps" "$remap_right_alt"
                cat <<'LUA'
local options = {}
local current = hl.get_config("input.kb_options") or ""
for raw_option in current:gmatch("[^,]+") do
  local option = raw_option:match("^%s*(.-)%s*$")
  local caps_conflict = remap_caps and (
    option:match("^caps:") or option == "compose:caps" or option == "ctrl:nocaps"
  )
  local alt_conflict = remap_right_alt and (
    option == "ctrl:ralt_rctrl" or option == "compose:ralt"
    or option:match("^lv3:ralt") or option:match("^lv5:ralt")
  )
  if not caps_conflict and not alt_conflict then
    table.insert(options, option)
  end
end
if remap_caps then table.insert(options, "caps:escape") end
if remap_right_alt then table.insert(options, "ctrl:ralt_rctrl") end
hl.config({ input = { kb_options = table.concat(options, ",") } })
LUA
            } > "$managed_config"

            if ! grep -qFx "$hook" "$main_config"; then
                cp -p "$main_config" "$main_config.bak.$(date +%s)"
                printf '\n%s\n' "$hook" >> "$main_config"
            fi

            if [[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]] && command -v hyprctl >/dev/null 2>&1; then
                hyprctl reload || return 1
                local config_errors
                config_errors=$(hyprctl configerrors) || return 1
                if [[ -n "$config_errors" ]]; then
                    error "Hyprland configuration errors: $config_errors"
                    return 1
                fi
                success "Keyboard remappings applied (all Hyprland keyboards)"
            else
                success "Keyboard remappings saved; they will apply at the next Hyprland login"
            fi
            ;;
        show)
            if [[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]] && command -v hyprctl >/dev/null 2>&1; then
                hyprctl getoption input:kb_options || return 1
            else
                info "Hyprland is not running in this session"
            fi
            if [[ -f "$KEYBOARD_FILE" ]]; then
                jq -r '.remaps[] | "\(.from) → \(.to)"' "$KEYBOARD_FILE"
            fi
            ;;
    esac
}

cmd_keyboard() {
    local subcmd="${1:-apply}"
    case "$subcmd" in
        apply|show) ;;
        *) error "Usage: dot keyboard [apply|show]"; return 1 ;;
    esac

    if _is_macos; then
        _keyboard_macos "$subcmd"
    elif [[ "$(uname -s)" == "Linux" && -d "${OMARCHY_PATH:-/usr/share/omarchy}" ]]; then
        _keyboard_omarchy "$subcmd"
    else
        warn "Keyboard remappings are supported on macOS and Omarchy only"
    fi
}

_keyboard_macos() {
    local subcmd="${1:-apply}"

    case "$subcmd" in
        apply)
            if [[ ! -f "$KEYBOARD_FILE" ]]; then
                warn "No keyboard.json found"
                return 0
            fi

            info "Applying keyboard remappings..."

            local remaps_count
            remaps_count=$(jq '.remaps | length' "$KEYBOARD_FILE")

            if [[ "$remaps_count" -eq 0 ]]; then
                info "No remappings configured"
                return 0
            fi

            # Build the hidutil mapping array
            local mappings="["
            local first=true

            for i in $(seq 0 $((remaps_count - 1))); do
                local from to from_code to_code comment
                from=$(jq -r ".remaps[$i].from" "$KEYBOARD_FILE")
                to=$(jq -r ".remaps[$i].to" "$KEYBOARD_FILE")
                comment=$(jq -r ".remaps[$i].comment // empty" "$KEYBOARD_FILE")

                from_code=$(_get_hid_code "$from")
                to_code=$(_get_hid_code "$to")

                if [[ -z "$from_code" || -z "$to_code" ]]; then
                    warn "Unknown key: $from or $to"
                    continue
                fi

                [[ "$first" == true ]] || mappings+=","
                first=false

                mappings+="{\"HIDKeyboardModifierMappingSrc\":$from_code,\"HIDKeyboardModifierMappingDst\":$to_code}"
                info "Mapping $from → $to${comment:+ ($comment)}"
            done

            mappings+="]"

            # Apply the remappings
            if hidutil property --set "{\"UserKeyMapping\":$mappings}" >/dev/null; then
                success "Keyboard remappings applied"
            else
                warn "Failed to apply keyboard remappings"
            fi
            ;;
        show)
            echo -e "${BLUE}=== Current Keyboard Remappings ===${NC}"
            hidutil property --get "UserKeyMapping" 2>/dev/null || echo "(none)"
            echo ""
            if [[ -f "$KEYBOARD_FILE" ]]; then
                echo -e "${BLUE}=== Configured Remappings (settings/keyboard.json) ===${NC}"
                jq '.remaps[] | "\(.from) → \(.to)\(if .comment then " (\(.comment))" else "" end)"' -r "$KEYBOARD_FILE"
            fi
            ;;
        *)
            error "Usage: dot keyboard [apply|show]"
            return 1
            ;;
    esac
}

# =============================================================================
# Commands
# =============================================================================

_apply_default_editor() {
    if [[ "$(uname -s)" != "Darwin" ]]; then
        return 0
    fi
    "$DOTFILES_DIR/home/.local/bin/install-neovim-app" --apply-associations
}

_show_default_editor() {
    if [[ "$(uname -s)" != "Darwin" ]]; then
        return 0
    fi
    if ! command -v utiluti >/dev/null 2>&1; then
        warn "utiluti is not installed"
        return 1
    fi

    echo ""
    echo -e "${BLUE}=== Default text editor ===${NC}"
    utiluti type public.plain-text
    echo ""
    echo -e "${BLUE}=== Default Swift editor ===${NC}"
    utiluti type "$(utiluti get-uti swift)"
}

_set_login_shell() {
    local fish_path
    fish_path="$(command -v fish 2>/dev/null || true)"

    if [[ -z "$fish_path" ]]; then
        warn "Fish shell not found, skipping login shell setup"
        return 0
    fi

    local current_shell
    current_shell="$(getent passwd "$USER" 2>/dev/null | cut -d: -f7 || true)"

    if [[ "$SHELL" == "$fish_path" || "$current_shell" == "$fish_path" ]]; then
        success "Login shell already set to fish"
        return 0
    fi

    if [[ ! -t 0 ]]; then
        warn "Skipping login shell setup: chsh may prompt without an interactive TTY"
        return 0
    fi

    if ! grep -qxF "$fish_path" /etc/shells; then
        info "Adding $fish_path to /etc/shells..."
        echo "$fish_path" | sudo tee -a /etc/shells >/dev/null
    fi

    info "Setting login shell to fish..."
    if sudo -n chsh -s "$fish_path" "$USER"; then
        success "Login shell set to $fish_path"
    elif [[ -t 0 ]] && chsh -s "$fish_path"; then
        success "Login shell set to $fish_path"
    else
        warn "Failed to set login shell"
    fi
}

