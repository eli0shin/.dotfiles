#!/usr/bin/env bash
# Prefer an existing home-LAN route, but fall back to Tailscale when away.
# This does not authenticate the LAN: an overlapping public LAN also wins.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

[[ "$(uname -s)" == Linux ]] || exit 0
[[ "$EUID" -eq 0 ]] || { echo "Run this script as root." >&2; exit 1; }

readonly priority=2500
readonly subnet=192.168.1.0/24
readonly service=dotfiles-tailscale-lan.service
readonly installed_script=/usr/local/libexec/dotfiles-tailscale-lan
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

case "${1:-}" in
    apply)
        apply_rule
        ;;
    remove)
        check_rule
        if [[ -n "$current" ]]; then
            ip -4 rule del priority "$priority" to "$subnet" lookup main suppress_prefixlength 0
        fi
        ;;
    install)
        check_rule
        install -D -o root -g root -m 0755 "$(realpath "$0")" "$installed_script"
        unit=$(mktemp)
        trap 'rm -f "$unit"' EXIT
        cat > "$unit" <<EOF
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
        install -o root -g root -m 0644 "$unit" "/etc/systemd/system/$service"
        systemctl daemon-reload
        # Reapply even if the oneshot unit is already active.
        "$installed_script" apply
        systemctl enable --now "$service"
        ;;
    *)
        echo "Usage: $0 {install|apply|remove}" >&2
        exit 2
        ;;
esac
