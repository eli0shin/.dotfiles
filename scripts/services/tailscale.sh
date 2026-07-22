#!/usr/bin/env bash
set -euo pipefail

label="homebrew.mxcl.tailscale"
resolver_dir="/etc/resolver"
resolver_file="$resolver_dir/home.arpa"

expected_resolver=$(mktemp)
trap 'rm -f "$expected_resolver"' EXIT
printf 'nameserver 100.100.100.100\ndomain home.arpa\nsearch_order 1\ntimeout 5\n' > "$expected_resolver"

# Remove the old user service if it is still present from an earlier setup.
user_plist="$HOME/Library/LaunchAgents/$label.plist"
if [[ -e "$user_plist" ]]; then
    launchctl bootout "gui/$(id -u)" "$user_plist" >/dev/null 2>&1 || true
    rm -f "$user_plist"
fi

if [[ ! -f "$resolver_file" ]] || ! cmp -s "$expected_resolver" "$resolver_file"; then
    echo "Updating Tailscale DNS resolver..."
    sudo install -d -m 755 "$resolver_dir"
    sudo install -o root -g wheel -m 644 "$expected_resolver" "$resolver_file"
fi

if ! launchctl print "system/$label" >/dev/null 2>&1; then
    echo "Starting Tailscale service..."
    sudo "$(command -v brew)" services start tailscale
else
    installed_version=$(tailscale version --json 2>/dev/null | jq -r '.long // empty')
    running_version=$(tailscale status --json 2>/dev/null | jq -r '.Version // empty')

    if [[ -z "$running_version" || "$installed_version" != "$running_version" ]]; then
        echo "Restarting Tailscale service..."
        sudo launchctl kickstart -k "system/$label"
    fi
fi

status=""
backend_state=""
for _ in {1..10}; do
    status=$(tailscale status --json 2>/dev/null || true)
    backend_state=$(jq -r '.BackendState // empty' <<< "$status" 2>/dev/null || true)
    [[ -n "$backend_state" && "$backend_state" != "Starting" ]] && break
    sleep 1
done

case "$backend_state" in
    Running)
        ;;
    Stopped)
        echo "Starting Tailscale network..."
        tailscale up --accept-dns --accept-routes --hostname=macbookpro >/dev/null 2>&1 || \
            tailscale up --reset --accept-dns --accept-routes --hostname=macbookpro >/dev/null 2>&1
        ;;
    NeedsLogin)
        echo "Tailscale needs authentication; run 'tailscale up' manually."
        exit 1
        ;;
    *)
        echo "Tailscale did not become ready (state: ${backend_state:-unknown})."
        exit 1
        ;;
esac

if ! tailscale debug prefs 2>/dev/null | jq -e '
    .RouteAll == true and
    .CorpDNS == true and
    .WantRunning == true and
    .Hostname == "macbookpro"
' >/dev/null; then
    echo "Updating Tailscale settings..."
    tailscale set --accept-dns=true --accept-routes=true --hostname=macbookpro
fi
