# shellcheck shell=bash
# macOS SMB automount configuration.

AUTOMOUNTS_FILE="$SETTINGS_DIR/automounts.json"
AUTOMOUNT_MAP_FILE="/etc/auto_nas"
AUTOMOUNT_MARKER="# dotfiles automount"

cmd_automount() {
    local subcmd="${1:-apply}"

    if ! _is_macos; then
        info "Skipping automount configuration on $(uname -s)"
        return 0
    fi

    case "$subcmd" in
        apply)
            if [[ ! -f "$AUTOMOUNTS_FILE" ]]; then
                warn "No automounts.json found"
                return 0
            fi

            if [[ "$(jq '.shares | length' "$AUTOMOUNTS_FILE")" -eq 0 ]]; then
                info "Removing automounts disabled for this profile"
                cmd_automount remove
                return
            fi

            local master_entry temp_map temp_master changed=false
            master_entry="/- $AUTOMOUNT_MAP_FILE -nosuid $AUTOMOUNT_MARKER"
            temp_map=$(mktemp -t dot_auto_nas)
            temp_master=$(mktemp -t dot_auto_master)
            trap 'rm -f "$temp_map" "$temp_master"; trap - RETURN' RETURN

            {
                echo "$AUTOMOUNT_MARKER"
                jq -r '.shares | to_entries | sort_by(.key)[] | "/Volumes/\(.key) -fstype=smbfs,soft \(.value)"' "$AUTOMOUNTS_FILE"
            } > "$temp_map"
            awk -v marker="$AUTOMOUNT_MARKER" 'index($0, marker) == 0' /etc/auto_master > "$temp_master"
            echo "$master_entry" >> "$temp_master"

            if [[ -e "$AUTOMOUNT_MAP_FILE" ]] && ! grep -Fqx "$AUTOMOUNT_MARKER" "$AUTOMOUNT_MAP_FILE"; then
                error "Refusing to overwrite unmanaged $AUTOMOUNT_MAP_FILE"
                return 1
            fi
            while IFS= read -r mountpoint; do
                if [[ ! -d "$mountpoint" ]]; then
                    info "Creating SMB automount point: $mountpoint"
                    sudo install -d -o root -g wheel -m 0755 "$mountpoint" || return 1
                    changed=true
                fi
            done < <(jq -r '.shares | keys[] | "/Volumes/\(.)"' "$AUTOMOUNTS_FILE")
            if ! cmp -s "$temp_map" "$AUTOMOUNT_MAP_FILE"; then
                info "Installing SMB automount map: $AUTOMOUNT_MAP_FILE"
                sudo install -o root -g wheel -m 0644 "$temp_map" "$AUTOMOUNT_MAP_FILE" || return 1
                changed=true
            fi
            if ! cmp -s "$temp_master" /etc/auto_master; then
                info "Registering direct SMB automount map in /etc/auto_master"
                sudo install -o root -g wheel -m 0644 "$temp_master" /etc/auto_master || return 1
                changed=true
            fi

            if [[ "$changed" == true ]]; then
                info "Reloading automount configuration"
                sudo automount -vc || return 1
                success "Configured SMB automounts"
            else
                success "Automount configuration already current"
            fi
            ;;
        show)
            if [[ -f "$AUTOMOUNTS_FILE" ]]; then
                jq '.' "$AUTOMOUNTS_FILE"
            else
                echo "No generated automount configuration"
            fi
            echo ""
            grep -F "$AUTOMOUNT_MARKER" /etc/auto_master || true
            [[ -f "$AUTOMOUNT_MAP_FILE" ]] && cat "$AUTOMOUNT_MAP_FILE" || true
            ;;
        remove)
            local temp_master changed=false
            temp_master=$(mktemp -t dot_auto_master)
            trap 'rm -f "$temp_master"; trap - RETURN' RETURN
            awk -v marker="$AUTOMOUNT_MARKER" 'index($0, marker) == 0' /etc/auto_master > "$temp_master"

            if ! cmp -s "$temp_master" /etc/auto_master; then
                info "Removing direct SMB automount map from /etc/auto_master"
                sudo install -o root -g wheel -m 0644 "$temp_master" /etc/auto_master || return 1
                changed=true
            fi
            if [[ -f "$AUTOMOUNT_MAP_FILE" ]] && grep -Fqx "$AUTOMOUNT_MARKER" "$AUTOMOUNT_MAP_FILE"; then
                info "Removing SMB automount map: $AUTOMOUNT_MAP_FILE"
                sudo rm -f "$AUTOMOUNT_MAP_FILE" || return 1
                changed=true
            fi
            if [[ "$changed" == true ]]; then
                info "Reloading automount configuration"
                sudo automount -vc || return 1
                success "Removed managed automounts"
            else
                success "No managed automounts to remove"
            fi
            ;;
        *)
            error "Usage: dot automount [apply|show|remove]"
            return 1
            ;;
    esac
}
