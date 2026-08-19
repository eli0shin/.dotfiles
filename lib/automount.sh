# shellcheck shell=bash
# macOS SMB automount configuration.

AUTOMOUNTS_FILE="$SETTINGS_DIR/automounts.json"
AUTOMOUNT_MASTER_FILE="${AUTOMOUNT_MASTER_FILE:-/etc/auto_master}"
AUTOMOUNT_MAP_FILE="${AUTOMOUNT_MAP_FILE:-/etc/auto_nas}"
AUTOMOUNT_MARKER="# dotfiles automount"

_automount_resolve_map_file() {
    local map_file="$1"

    if [[ "$map_file" == /* ]]; then
        printf '%s\n' "$map_file"
    else
        printf '%s/%s\n' "$(dirname "$AUTOMOUNT_MASTER_FILE")" "$map_file"
    fi
}

_automount_map_is_smb_only() {
    local map_file="$1"

    [[ -f "$map_file" ]] || return 1
    awk '
        {
            sub(/[[:space:]]*#.*/, "")
            if ($0 ~ /^[[:space:]]*$/) next
            if ($0 ~ /(^|[[:space:]])-fstype=smbfs(,|[[:space:]]|$)/) smb++
            else other++
        }
        END { exit !(smb > 0 && other == 0) }
    ' "$map_file"
}

_automount_unconfigured_smb_maps() {
    local mount_type map_name map_file

    while read -r mount_type map_name _; do
        [[ "$mount_type" == "/-" && -n "$map_name" ]] || continue
        map_file=$(_automount_resolve_map_file "$map_name")
        if [[ "$map_file" != "$AUTOMOUNT_MAP_FILE" ]] && _automount_map_is_smb_only "$map_file"; then
            printf '%s\n' "$map_file"
        fi
    done < <(sed 's/[[:space:]]*#.*//' "$AUTOMOUNT_MASTER_FILE")
}

_automount_write_reconciled_master() {
    local output_file="$1"
    local line entry mount_type map_name map_file

    : > "$output_file"
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == *"$AUTOMOUNT_MARKER"* ]]; then
            continue
        fi
        entry="${line%%#*}"
        read -r mount_type map_name _ <<< "$entry"
        if [[ "$mount_type" == "/-" && -n "$map_name" ]]; then
            map_file=$(_automount_resolve_map_file "$map_name")
            if [[ "$map_file" != "$AUTOMOUNT_MAP_FILE" ]] && _automount_map_is_smb_only "$map_file"; then
                continue
            fi
        fi
        printf '%s\n' "$line" >> "$output_file"
    done < "$AUTOMOUNT_MASTER_FILE"
}

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

            local master_entry temp_map temp_master stale_maps_file changed=false
            master_entry="/- $AUTOMOUNT_MAP_FILE -nosuid $AUTOMOUNT_MARKER"
            temp_map=$(mktemp -t dot_auto_nas.XXXXXX)
            temp_master=$(mktemp -t dot_auto_master.XXXXXX)
            stale_maps_file=$(mktemp -t dot_stale_auto_nas.XXXXXX)
            trap 'rm -f "$temp_map" "$temp_master" "$stale_maps_file"; trap - RETURN' RETURN

            {
                echo "$AUTOMOUNT_MARKER"
                jq -r --arg home "$HOME" '.shares | to_entries | sort_by(.key)[] | "\($home)/\(.key) -fstype=smbfs,soft,rw,filemode=0777,dirmode=0777,nodev \(.value)"' "$AUTOMOUNTS_FILE"
            } > "$temp_map"
            _automount_unconfigured_smb_maps | sort -u > "$stale_maps_file"
            _automount_write_reconciled_master "$temp_master"
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
            done < <(jq -r --arg home "$HOME" '.shares | keys[] | "\($home)/\(.)"' "$AUTOMOUNTS_FILE")
            if ! cmp -s "$temp_map" "$AUTOMOUNT_MAP_FILE"; then
                info "Installing SMB automount map: $AUTOMOUNT_MAP_FILE"
                sudo install -o root -g wheel -m 0644 "$temp_map" "$AUTOMOUNT_MAP_FILE" || return 1
                changed=true
            fi
            if ! cmp -s "$temp_master" "$AUTOMOUNT_MASTER_FILE"; then
                info "Reconciling direct SMB automount maps in $AUTOMOUNT_MASTER_FILE"
                sudo install -o root -g wheel -m 0644 "$temp_master" "$AUTOMOUNT_MASTER_FILE" || return 1
                changed=true
            fi
            while IFS= read -r stale_map; do
                info "Removing unconfigured SMB automount map: $stale_map"
                sudo rm -f "$stale_map" || return 1
                changed=true
            done < "$stale_maps_file"

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
            grep -F "$AUTOMOUNT_MARKER" "$AUTOMOUNT_MASTER_FILE" || true
            [[ -f "$AUTOMOUNT_MAP_FILE" ]] && cat "$AUTOMOUNT_MAP_FILE" || true
            ;;
        remove)
            local temp_master stale_maps_file changed=false
            temp_master=$(mktemp -t dot_auto_master.XXXXXX)
            stale_maps_file=$(mktemp -t dot_stale_auto_nas.XXXXXX)
            trap 'rm -f "$temp_master" "$stale_maps_file"; trap - RETURN' RETURN
            _automount_unconfigured_smb_maps | sort -u > "$stale_maps_file"
            _automount_write_reconciled_master "$temp_master"

            if ! cmp -s "$temp_master" "$AUTOMOUNT_MASTER_FILE"; then
                info "Removing SMB automount maps from $AUTOMOUNT_MASTER_FILE"
                sudo install -o root -g wheel -m 0644 "$temp_master" "$AUTOMOUNT_MASTER_FILE" || return 1
                changed=true
            fi
            while IFS= read -r stale_map; do
                info "Removing unconfigured SMB automount map: $stale_map"
                sudo rm -f "$stale_map" || return 1
                changed=true
            done < "$stale_maps_file"
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
