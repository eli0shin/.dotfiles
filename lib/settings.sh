# shellcheck shell=bash
# Machine settings and login shell configuration.

PMSET_FILE="$SETTINGS_DIR/pmset.json"
DEFAULTS_FILE="$SETTINGS_DIR/defaults.json"
KEYBOARD_FILE="$SETTINGS_DIR/keyboard.json"

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

            local needs_change=false

            while IFS= read -r line; do
                local key value current
                key=$(echo "$line" | awk '{print $1}')
                value=$(echo "$line" | awk '{print $2}')
                current=$(pmset -g | grep -E "^\s*$key\s+" | awk '{print $2}')

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

_get_app_for_domain() {
    case "$1" in
        com.apple.finder) echo "Finder" ;;
        com.apple.dock) echo "Dock" ;;
        com.apple.SystemUIServer) echo "SystemUIServer" ;;
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
                    current=$(_defaults_read "$domain" "$key")
                    if [[ $? -ne 0 ]] || [[ -z "$current" ]]; then
                        current="__NOT_SET__"
                    fi

                    # Convert JSON booleans to defaults format (1/0)
                    local expected="$value"
                    if [[ "$value_type" == "boolean" ]]; then
                        [[ "$value" == "true" ]] && expected="1" || expected="0"
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
                                if [[ "$value" =~ ^[0-9]+$ ]]; then
                                    _defaults_write "$domain" "$key" -int "$value"
                                else
                                    _defaults_write "$domain" "$key" -float "$value"
                                fi
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

cmd_keyboard() {
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

