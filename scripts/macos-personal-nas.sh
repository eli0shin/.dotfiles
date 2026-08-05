#!/usr/bin/env bash
set -euo pipefail

# Standalone macOS setup for the guest-writable personal NAS share.

MAP_FILE="/etc/auto_personal_nas"
MARKER="# personal NAS automount"
MOUNT_POINT="/Volumes/personal"
MASTER_ENTRY="/- $MAP_FILE -nosuid $MARKER"

info() { printf '[INFO] %s\n' "$1"; }
success() { printf '[OK] %s\n' "$1"; }
error() { printf '[ERROR] %s\n' "$1" >&2; }

personal_share_is_automounted() {
    mount | grep -F '//guest:@nas.home.arpa/personal on /Volumes/personal (smbfs,' | grep -Fq 'automounted'
}

if [[ $# -ne 0 ]]; then
    error "This script does not accept arguments"
    exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
    error "This script requires macOS"
    exit 1
fi

map_temp=$(mktemp -t personal_nas_map)
master_temp=$(mktemp -t personal_nas_master)
trap 'rm -f "$map_temp" "$master_temp"' EXIT

cat > "$map_temp" <<'EOF'
# personal NAS automount
/Volumes/personal -fstype=smbfs,soft ://guest:@nas.home.arpa/personal
EOF

awk -v marker="$MARKER" 'index($0, marker) == 0' /etc/auto_master > "$master_temp"
printf '%s\n' "$MASTER_ENTRY" >> "$master_temp"

if [[ -e "$MAP_FILE" ]] && ! grep -Fqx "$MARKER" "$MAP_FILE"; then
    error "Refusing to overwrite unmanaged $MAP_FILE"
    exit 1
fi

if [[ -L "$MOUNT_POINT" || ( -e "$MOUNT_POINT" && ! -d "$MOUNT_POINT" ) ]]; then
    error "Refusing to use unexpected path at $MOUNT_POINT"
    exit 1
fi
if mount | grep -Fq " on $MOUNT_POINT " && ! personal_share_is_automounted; then
    error "$MOUNT_POINT is already used by another mount; unmount it before running this script"
    exit 1
fi
if [[ -d "$MOUNT_POINT" && "$(stat -f '%Su:%Sg' "$MOUNT_POINT")" != "root:wheel" ]]; then
    error "Refusing to use $MOUNT_POINT because it is not owned by root:wheel"
    exit 1
fi
if [[ ! -d "$MOUNT_POINT" ]]; then
    info "Creating SMB automount point: $MOUNT_POINT"
    sudo install -d -o root -g wheel -m 0755 "$MOUNT_POINT"
fi

if ! cmp -s "$map_temp" "$MAP_FILE"; then
    info "Installing SMB automount map: $MAP_FILE"
    sudo install -o root -g wheel -m 0644 "$map_temp" "$MAP_FILE"
fi

if ! cmp -s "$master_temp" /etc/auto_master; then
    info "Registering personal SMB automount in /etc/auto_master"
    sudo install -o root -g wheel -m 0644 "$master_temp" /etc/auto_master
fi

info "Reloading automount configuration"
sudo automount -vc

info "Connecting to $MOUNT_POINT"
if ! ls "$MOUNT_POINT" >/dev/null; then
    error "Automount was configured, but the personal NAS share is not currently reachable"
    exit 1
fi
if ! personal_share_is_automounted; then
    error "$MOUNT_POINT is not the expected automounted personal SMB share"
    exit 1
fi
success "Personal NAS share is available at $MOUNT_POINT"
