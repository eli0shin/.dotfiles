#!/usr/bin/env bash
# Prefer an existing home-LAN route, but fall back to Tailscale when away.
# This does not authenticate the LAN: an overlapping public LAN also wins.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

[[ "$(uname -s)" == Linux ]] || exit 0

readonly priority=2500
readonly subnet=192.168.1.0/24
readonly service="${TAILSCALE_LAN_SERVICE:-dotfiles-tailscale-lan.service}"
readonly installed_script="${TAILSCALE_LAN_INSTALLED_SCRIPT:-/usr/local/libexec/dotfiles-tailscale-lan}"
readonly unit_file="${TAILSCALE_LAN_UNIT_FILE:-/etc/systemd/system/$service}"
source_script=$(realpath "$0")
readonly source_script
readonly expected="$priority: from all to $subnet lookup main suppress_prefixlength 0"

check_rule() {
    current=$(ip -4 rule show priority "$priority" | awk '{$1=$1; print}')
    if [[ -n "$current" && "$current" != "$expected" ]]; then
        echo "Refusing to change another routing rule at priority $priority." >&2
        return 1
    fi
}

apply_rule() {
    check_rule
    if [[ -z "$current" ]]; then
        ip -4 rule add priority "$priority" to "$subnet" lookup main suppress_prefixlength 0
    fi
}

write_unit() {
    cat > "$1" <<EOF
[Unit]
Description=Prefer the home LAN over Tailscale when a specific LAN route exists
Before=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
ExecStart=$installed_script apply
ExecStop=$installed_script remove
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
}

check_install() {
    local expected_unit
    expected_unit=$(mktemp)
    write_unit "$expected_unit"

    if cmp -s "$source_script" "$installed_script" \
        && [[ "$(stat -c '%u:%g:%a' "$installed_script" 2>/dev/null)" == "0:0:755" ]] \
        && cmp -s "$expected_unit" "$unit_file" \
        && [[ "$(stat -c '%u:%g:%a' "$unit_file" 2>/dev/null)" == "0:0:644" ]] \
        && systemctl is-enabled --quiet "$service" \
        && systemctl is-active --quiet "$service" \
        && check_rule \
        && [[ "$current" == "$expected" ]]; then
        rm -f "$expected_unit"
        return 0
    fi

    rm -f "$expected_unit"
    return 1
}

case "${1:-}" in
    check-install)
        check_install
        ;;
    apply)
        [[ "$EUID" -eq 0 ]] || { echo "Run this script as root." >&2; exit 1; }
        apply_rule
        ;;
    remove)
        [[ "$EUID" -eq 0 ]] || { echo "Run this script as root." >&2; exit 1; }
        check_rule
        if [[ -n "$current" ]]; then
            ip -4 rule del priority "$priority" to "$subnet" lookup main suppress_prefixlength 0
        fi
        ;;
    install)
        [[ "$EUID" -eq 0 ]] || { echo "Run this script as root." >&2; exit 1; }
        check_rule
        install -D -o root -g root -m 0755 "$source_script" "$installed_script"
        unit=$(mktemp)
        trap 'rm -f "$unit"' EXIT
        write_unit "$unit"
        install -o root -g root -m 0644 "$unit" "$unit_file"
        systemctl daemon-reload
        # Reapply even if the oneshot unit is already active.
        "$installed_script" apply
        systemctl enable --now "$service"
        ;;
    *)
        echo "Usage: $0 {check-install|install|apply|remove}" >&2
        exit 2
        ;;
esac
