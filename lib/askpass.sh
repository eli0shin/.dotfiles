# shellcheck shell=bash
# macOS GUI sudo password prompt.
#
# sudo reads its password from the terminal when one exists (SSH sessions,
# shells inside herdr). When there is no terminal - GUI apps, agents, no-tty
# remote commands - sudo needs an askpass helper, otherwise it exits with
# "a terminal is required to read the password".
#
# This module installs a line in /private/etc/sudo.conf pointing sudo at the
# stowed helper in ~/bin/askpass. The helper shows a native macOS dialog and
# degrades gracefully: outside an Aqua session it exits nonzero, so SSH-only
# machines and remote sessions behave exactly as before.

ASKPASS_HELPER="$HOME/bin/askpass"
SUDO_CONF="${DOT_SUDO_CONF:-/private/etc/sudo.conf}"
ASKPASS_LINE="Path askpass $ASKPASS_HELPER"

cmd_askpass() {
    local subcmd="${1:-apply}"

    case "$subcmd" in
        apply) _askpass_apply ;;
        show)  _askpass_show ;;
        *)
            error "Usage: dot askpass [apply|show]"
            return 1
            ;;
    esac
}

_askpass_apply() {
    if ! _is_macos; then
        warn "Skipping sudo askpass setup on $(uname -s)"
        return 0
    fi

    if [[ ! -f "$ASKPASS_HELPER" ]]; then
        warn "Askpass helper not found at $ASKPASS_HELPER (run 'dot stow' first)"
        return 1
    fi

    if [[ ! -x "$ASKPASS_HELPER" ]]; then
        chmod +x "$ASKPASS_HELPER"
    fi

    # Already correct - the common case on repeated runs. Never append a
    # duplicate line.
    if grep -qsFx "$ASKPASS_LINE" "$SUDO_CONF"; then
        success "sudo askpass already configured"
        return 0
    fi

    # An uncommented line with a different value: fix it in place so a
    # single authoritative line remains (sudo applies duplicate Path
    # lines last-one-wins, which would hide which one is in effect).
    if grep -qs "^Path askpass " "$SUDO_CONF"; then
        info "Updating sudo askpass path in $SUDO_CONF"
        sudo sed -i '' "s|^Path askpass .*|$ASKPASS_LINE|" "$SUDO_CONF"
    else
        info "Adding sudo askpass helper to $SUDO_CONF"
        printf '%s\n' "$ASKPASS_LINE" | sudo tee -a "$SUDO_CONF" >/dev/null
    fi

    success "sudo askpass configured ($ASKPASS_LINE)"
}

_askpass_show() {
    if ! _is_macos; then
        warn "Skipping sudo askpass on $(uname -s)"
        return 0
    fi

    echo -e "${BLUE}=== $SUDO_CONF (askpass) ===${NC}"
    if grep -n "askpass" "$SUDO_CONF" 2>/dev/null; then
        :
    else
        warn "No askpass entry found"
    fi

    if [[ -f "$ASKPASS_HELPER" ]]; then
        success "Helper installed at $ASKPASS_HELPER"
    else
        warn "Helper missing at $ASKPASS_HELPER (run 'dot stow' first)"
    fi
}
