# shellcheck shell=bash
# Homebrew services and macOS LaunchAgents.

SERVICES_FILE="$SETTINGS_DIR/services.json"
LAUNCH_AGENTS_FILE="$SETTINGS_DIR/launch-agents.json"
LAUNCH_AGENTS_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/launch-agents"
LAUNCH_AGENTS_LABELS_FILE="$LAUNCH_AGENTS_STATE_DIR/labels.txt"

_start_services() {
    if ! _is_macos && ! _has_systemd; then
        warn "Skipping brew services: requires macOS or Linux with systemd"
        return 0
    fi

    if [[ ! -f "$SERVICES_FILE" ]]; then
        return 0
    fi

    local count
    count=$(jq 'length' "$SERVICES_FILE")
    if [[ "$count" -eq 0 ]]; then
        return 0
    fi

    info "Starting brew services..."

    local services
    services=$(jq -c '.[]' "$SERVICES_FILE")

    while IFS= read -r svc_json; do
        local name script use_sudo
        name=$(echo "$svc_json" | jq -r '.name')
        script=$(echo "$svc_json" | jq -r '.script // empty')
        use_sudo=$(echo "$svc_json" | jq -r '.sudo // false')

        if [[ -n "$script" ]]; then
            if [[ "$script" != /* ]]; then
                script="$DOTFILES_DIR/$script"
            fi

            info "Reconciling $name..."
            if "$script"; then
                success "$name is ready"
            else
                warn "Failed to reconcile $name"
            fi
            continue
        fi

        # Check if service is already running
        local check_cmd is_running
        check_cmd=$(echo "$svc_json" | jq -r '.check // empty')

        if [[ -n "$check_cmd" ]]; then
            # Use custom check command
            if eval "$check_cmd"; then
                is_running=1
            else
                is_running=0
            fi
        else
            # Fall back to brew services list
            is_running=$(brew services list 2>/dev/null | grep "^$name " | grep -c "started" || true)
        fi

        # Run pre-start commands before checking/starting the service.
        # Useful for cleaning up stale LaunchAgents or conflicting service state.
        local pre_start
        pre_start=$(echo "$svc_json" | jq -r '.pre_start // empty')
        if [[ -n "$pre_start" ]]; then
            info "Running pre-start for $name..."
            if eval "$pre_start"; then
                success "Pre-start complete for $name"
            else
                warn "Pre-start failed for $name"
            fi
        fi

        if [[ "$is_running" -gt 0 ]]; then
            success "$name service already running"
        else
            info "Starting $name service..."
            if [[ "$use_sudo" == "true" ]]; then
                if sudo brew services start "$name"; then
                    success "Started $name"
                else
                    warn "Failed to start $name"
                fi
            else
                if brew services start "$name"; then
                    success "Started $name"
                else
                    warn "Failed to start $name"
                fi
            fi
        fi

        # Run post-start commands
        local post_start
        post_start=$(echo "$svc_json" | jq -r '.post_start // empty')
        if [[ -n "$post_start" ]]; then
            info "Running post-start for $name..."
            if eval "$post_start"; then
                success "Post-start complete for $name"
            else
                warn "Post-start failed for $name"
            fi
        fi
    done <<< "$services"
}

cmd_service() {
    local subcmd="${1:-}"
    shift || true

    case "$subcmd" in
        start)
            _start_services
            ;;
        list)
            if [[ -f "$SERVICES_FILE" ]]; then
                echo -e "${BLUE}=== Managed Services ===${NC}"
                jq -r '.[] | "\(.name) (sudo: \(.sudo // false))"' "$SERVICES_FILE"
            else
                echo "No services configured"
            fi
            echo ""
            echo -e "${BLUE}=== Running Brew Services ===${NC}"
            brew services list
            ;;
        *)
            error "Usage: dot service <start|list>"
            return 1
            ;;
    esac
}

# =============================================================================
# LaunchAgent Helpers
# =============================================================================

_expand_path() {
    local path="$1"
    path="${path/#\~/$HOME}"
    echo "$path"
}

_install_launch_agents() {
    if [[ ! -f "$LAUNCH_AGENTS_FILE" ]]; then
        if [[ -f "$LAUNCH_AGENTS_LABELS_FILE" ]]; then
            _unload_launch_agents
        fi
        return 0
    fi

    info "Installing LaunchAgents..."
    mkdir -p "$HOME/Library/LaunchAgents" "$LAUNCH_AGENTS_STATE_DIR"

    local current_labels
    current_labels=$(mktemp)
    jq -r '.[].label' "$LAUNCH_AGENTS_FILE" | sort -u > "$current_labels"

    if [[ -f "$LAUNCH_AGENTS_LABELS_FILE" ]]; then
        while IFS= read -r stale_label; do
            [[ -z "$stale_label" ]] && continue
            if ! grep -qxF "$stale_label" "$current_labels"; then
                local stale_plist="$HOME/Library/LaunchAgents/$stale_label.plist"
                launchctl bootout "gui/$(id -u)" "$stale_plist" >/dev/null 2>&1 || true
                rm -f "$stale_plist"
                success "Removed stale $stale_label"
            fi
        done < "$LAUNCH_AGENTS_LABELS_FILE"
    fi

    cp "$current_labels" "$LAUNCH_AGENTS_LABELS_FILE"
    rm -f "$current_labels"

    local count
    count=$(jq 'length' "$LAUNCH_AGENTS_FILE")
    if [[ "$count" -eq 0 ]]; then
        success "No LaunchAgents configured"
        return 0
    fi

    local agents
    agents=$(jq -c '.[]' "$LAUNCH_AGENTS_FILE")

    while IFS= read -r agent_json; do
        local label script plist run_at_load interval stdout_log stderr_log
        label=$(echo "$agent_json" | jq -r '.label')
        script=$(_expand_path "$(echo "$agent_json" | jq -r '.script')")
        plist="$HOME/Library/LaunchAgents/$label.plist"
        run_at_load=$(echo "$agent_json" | jq -r '.run_at_load // true')
        interval=$(echo "$agent_json" | jq -r '.start_interval_seconds // empty')
        stdout_log=$(_expand_path "$(echo "$agent_json" | jq -r '.stdout_log // "~/Library/Logs/dotfiles/launch-agents.log"')")
        stderr_log=$(_expand_path "$(echo "$agent_json" | jq -r '.stderr_log // "~/Library/Logs/dotfiles/launch-agents.err.log"')")

        if [[ ! -x "$script" ]]; then
            warn "LaunchAgent script is not executable: $script"
            continue
        fi

        mkdir -p "$(dirname "$stdout_log")" "$(dirname "$stderr_log")"

        if ! python3 - "$plist" "$label" "$script" "$run_at_load" "$interval" "$stdout_log" "$stderr_log" <<'PY'
import plistlib
import sys

plist_path, label, script, run_at_load, interval, stdout_log, stderr_log = sys.argv[1:]
data = {
    "Label": label,
    "ProgramArguments": [script],
    "RunAtLoad": run_at_load == "true",
    "StandardOutPath": stdout_log,
    "StandardErrorPath": stderr_log,
}
if interval:
    data["StartInterval"] = int(interval)
with open(plist_path, "wb") as f:
    plistlib.dump(data, f, sort_keys=False)
PY
        then
            warn "Invalid LaunchAgent config for $label"
            continue
        fi

        launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
        if launchctl bootstrap "gui/$(id -u)" "$plist" >/dev/null 2>&1; then
            launchctl enable "gui/$(id -u)/$label" >/dev/null 2>&1 || true
            success "Installed $label"
        else
            warn "Failed to load $label"
        fi
    done <<< "$agents"
}

_unload_launch_agents() {
    {
        [[ -f "$LAUNCH_AGENTS_LABELS_FILE" ]] && cat "$LAUNCH_AGENTS_LABELS_FILE"
        [[ -f "$LAUNCH_AGENTS_FILE" ]] && jq -r '.[].label' "$LAUNCH_AGENTS_FILE"
    } | sort -u | while IFS= read -r label; do
        [[ -z "$label" ]] && continue
        local plist="$HOME/Library/LaunchAgents/$label.plist"
        launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
        rm -f "$plist"
        success "Unloaded $label"
    done
    rm -f "$LAUNCH_AGENTS_LABELS_FILE"
}

cmd_launch_agent() {
    local subcmd="${1:-}"
    shift || true

    case "$subcmd" in
        install)
            _install_launch_agents
            ;;
        unload)
            _unload_launch_agents
            ;;
        list)
            if [[ -f "$LAUNCH_AGENTS_FILE" ]]; then
                echo -e "${BLUE}=== Managed LaunchAgents ===${NC}"
                jq -r '.[] | "\(.label) every \(.start_interval_seconds // "n/a")s -> \(.script)"' "$LAUNCH_AGENTS_FILE"
            else
                echo "No LaunchAgents configured"
            fi
            ;;
        *)
            error "Usage: dot launch-agent <install|unload|list>"
            return 1
            ;;
    esac
}

# =============================================================================
# Pmset Helpers
# =============================================================================

