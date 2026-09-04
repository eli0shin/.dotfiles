# shellcheck shell=bash
# Certificate bootstrap helpers.

HOMELAB_CA_URL="${HOMELAB_CA_URL:-http://ca.home.arpa/homelab-local-ca.crt}"
HOMELAB_CA_SHA256="${HOMELAB_CA_SHA256:-DCA9E760BFAD7D3E4237B83F3B790C83F554D9BA0F63B3FA729F5F157E6EC8D1}"

_homelab_ca_is_trusted_in_macos_system_keychain() {
    local source_ca="$1"
    local fingerprint
    local keychain_certificates

    fingerprint=$(openssl x509 -in "$source_ca" -noout -fingerprint -sha256 \
        | awk -F= 'NR == 1 { print $2 }' | tr -d '[:space:]:') || return 1
    keychain_certificates=$(security find-certificate -a -Z \
        /Library/Keychains/System.keychain 2>/dev/null) || return 1

    grep -Fqx "SHA-256 hash: $fingerprint" <<< "$keychain_certificates" \
        && security verify-cert -c "$source_ca" \
            -k /Library/Keychains/System.keychain >/dev/null 2>&1
}

_trust_homelab_ca_globally() {
    local source_ca="$1"
    local system_ca
    local system_root="${HOMELAB_CA_ROOT:-}"

    if ! has sudo; then
        warn "Cannot trust the homelab CA globally because sudo is unavailable"
        return 0
    fi

    case "$(_current_platform)" in
        linux)
            if has update-ca-trust; then
                if [[ -d "$system_root/etc/ca-certificates/trust-source/anchors" ]]; then
                    system_ca="$system_root/etc/ca-certificates/trust-source/anchors/homelab-local-ca.crt"
                elif [[ -d "$system_root/etc/pki/ca-trust/source/anchors" ]]; then
                    system_ca="$system_root/etc/pki/ca-trust/source/anchors/homelab-local-ca.crt"
                else
                    warn "Cannot find the update-ca-trust anchor directory"
                    return 0
                fi

                if ! sudo install -D -m 0644 "$source_ca" "$system_ca" \
                    || ! sudo update-ca-trust; then
                    warn "Could not add the homelab CA to the system trust store"
                    return 0
                fi
            elif has update-ca-certificates; then
                system_ca="$system_root/usr/local/share/ca-certificates/homelab-local-ca.crt"
                if ! sudo install -D -m 0644 "$source_ca" "$system_ca" \
                    || ! sudo update-ca-certificates; then
                    warn "Could not add the homelab CA to the system trust store"
                    return 0
                fi
            else
                warn "Cannot trust the homelab CA globally because no supported trust-store command is available"
                return 0
            fi
            ;;
        darwin)
            if ! has security; then
                warn "Could not add the homelab CA to the system keychain"
                return 0
            fi

            if _homelab_ca_is_trusted_in_macos_system_keychain "$source_ca"; then
                success "Homelab CA already trusted globally"
                return 0
            fi

            if ! sudo security add-trusted-cert -d -r trustRoot \
                -k /Library/Keychains/System.keychain "$source_ca"; then
                warn "Could not add the homelab CA to the system keychain"
                return 0
            fi
            ;;
        *)
            warn "Cannot trust the homelab CA globally on this platform"
            return 0
            ;;
    esac

    success "Trusted the homelab CA globally"
}

_install_homelab_ca() {
    local destination="$HOME/.config/certs/homelab-local-ca.crt"
    local destination_dir
    local downloaded_fingerprint
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

    downloaded_fingerprint=$(openssl x509 -in "$temporary_ca" -noout -fingerprint -sha256 \
        | awk -F= 'NR == 1 { print $2 }' | tr -d '[:space:]:')
    if [[ $downloaded_fingerprint != "$HOMELAB_CA_SHA256" ]]; then
        rm -f "$temporary_ca"
        warn "Downloaded homelab CA fingerprint does not match; keeping the current certificate"
        return 0
    fi

    if ! chmod 0644 "$temporary_ca" || ! mv "$temporary_ca" "$destination"; then
        rm -f "$temporary_ca"
        warn "Could not install the homelab CA; keeping the current certificate"
        return 0
    fi

    success "Installed homelab CA at $destination"
    _trust_homelab_ca_globally "$destination"
}
