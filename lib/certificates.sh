# shellcheck shell=bash
# Certificate bootstrap helpers.

HOMELAB_CA_URL="${HOMELAB_CA_URL:-http://ca.home.arpa/homelab-local-ca.crt}"

_install_homelab_ca() {
    local destination="$HOME/.config/certs/homelab-local-ca.crt"
    local destination_dir
    local temporary_ca

    if ! has curl || ! has openssl; then
        warn "Cannot install the homelab CA because curl or openssl is unavailable"
        return 0
    fi

    destination_dir=$(dirname "$destination")
    if ! mkdir -p "$destination_dir"; then
        warn "Could not create $destination_dir; keeping the current homelab CA"
        return 0
    fi

    if ! temporary_ca=$(mktemp "$destination.tmp.XXXXXX"); then
        warn "Could not create a temporary file; keeping the current homelab CA"
        return 0
    fi

    if ! curl -fsSL --connect-timeout 5 --max-time 15 \
        "$HOMELAB_CA_URL" -o "$temporary_ca"; then
        rm -f "$temporary_ca"
        warn "Could not download the homelab CA; keeping the current certificate"
        return 0
    fi

    if ! openssl x509 -in "$temporary_ca" -noout -checkend 0 >/dev/null 2>&1 \
        || ! openssl verify -CAfile "$temporary_ca" "$temporary_ca" >/dev/null 2>&1 \
        || ! openssl x509 -in "$temporary_ca" -noout -text | grep -q 'CA:TRUE'; then
        rm -f "$temporary_ca"
        warn "Downloaded homelab CA is invalid; keeping the current certificate"
        return 0
    fi

    if ! chmod 0644 "$temporary_ca" || ! mv "$temporary_ca" "$destination"; then
        rm -f "$temporary_ca"
        warn "Could not install the homelab CA; keeping the current certificate"
        return 0
    fi

    success "Installed homelab CA at $destination"
}
