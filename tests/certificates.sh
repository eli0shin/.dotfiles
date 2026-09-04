#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
mkdir -p "$HOME"
COMMAND_LOG="$TEST_ROOT/commands.log"
HOMELAB_CA_ROOT="$TEST_ROOT/system"
mkdir -p "$HOMELAB_CA_ROOT/etc/ca-certificates/trust-source/anchors"

info() { :; }
success() { :; }
warn() { :; }
error() { :; }
has() {
    case "$1" in
        curl|openssl|sudo|update-ca-trust) return 0 ;;
        *) return 1 ;;
    esac
}
_current_platform() { printf '%s\n' linux; }
curl() { printf '%s\n' 'test certificate' > "${@: -1}"; }
openssl() {
    if [[ " $* " == *' -text '* ]]; then
        printf '%s\n' 'CA:TRUE'
    elif [[ " $* " == *' -fingerprint '* ]]; then
        printf '%s\n' "sha256 Fingerprint=${MOCK_FINGERPRINT:-$HOMELAB_CA_SHA256}"
    fi
    return 0
}
sudo() { printf '%s\n' "$*" >> "$COMMAND_LOG"; }

# shellcheck disable=SC1091
source "$(dirname "$0")/../lib/certificates.sh"

_install_homelab_ca

user_ca="$HOME/.config/certs/homelab-local-ca.crt"
[[ -f $user_ca ]] || {
    echo "FAIL: homelab CA was not installed in the user certificate directory" >&2
    exit 1
}

grep -Fqx "install -D -m 0644 $user_ca $HOMELAB_CA_ROOT/etc/ca-certificates/trust-source/anchors/homelab-local-ca.crt" "$COMMAND_LOG" || {
    echo "FAIL: homelab CA was not installed as a system trust anchor" >&2
    exit 1
}

grep -Fqx 'update-ca-trust' "$COMMAND_LOG" || {
    echo "FAIL: system trust store was not updated" >&2
    exit 1
}

rm -f "$user_ca"
: > "$COMMAND_LOG"
MOCK_FINGERPRINT=0000000000000000000000000000000000000000000000000000000000000000
_install_homelab_ca

[[ ! -e $user_ca ]] || {
    echo "FAIL: a homelab CA with the wrong fingerprint was installed" >&2
    exit 1
}
[[ ! -s $COMMAND_LOG ]] || {
    echo "FAIL: a homelab CA with the wrong fingerprint was globally trusted" >&2
    exit 1
}

unset MOCK_FINGERPRINT
rm -rf "$HOMELAB_CA_ROOT/etc/ca-certificates"
mkdir -p "$HOMELAB_CA_ROOT/etc/pki/ca-trust/source/anchors"
: > "$COMMAND_LOG"
_install_homelab_ca

grep -Fqx "install -D -m 0644 $user_ca $HOMELAB_CA_ROOT/etc/pki/ca-trust/source/anchors/homelab-local-ca.crt" "$COMMAND_LOG" || {
    echo "FAIL: homelab CA did not use the RHEL system trust anchor directory" >&2
    exit 1
}

grep -Fqx 'update-ca-trust' "$COMMAND_LOG" || {
    echo "FAIL: RHEL system trust store was not updated" >&2
    exit 1
}

# An existing matching certificate in the macOS System keychain must not prompt
# for sudo again.
_current_platform() { printf '%s\n' darwin; }
has() {
    case "$1" in
        curl|openssl|security|sudo) return 0 ;;
        *) return 1 ;;
    esac
}
security() {
    case "$1" in
        find-certificate)
            printf '%s\n' "SHA-256 hash: ${MOCK_KEYCHAIN_FINGERPRINT:-$HOMELAB_CA_SHA256}"
            ;;
        verify-cert)
            [[ ${MOCK_KEYCHAIN_TRUSTED:-true} == true ]]
            ;;
    esac
}

: > "$COMMAND_LOG"
_trust_homelab_ca_globally "$user_ca"
[[ ! -s $COMMAND_LOG ]] || {
    echo "FAIL: an existing trusted homelab CA was trusted again on macOS" >&2
    exit 1
}

MOCK_KEYCHAIN_TRUSTED=false
_trust_homelab_ca_globally "$user_ca"
grep -Fqx "security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $user_ca" "$COMMAND_LOG" || {
    echo "FAIL: an untrusted homelab CA was not trusted on macOS" >&2
    exit 1
}

unset MOCK_KEYCHAIN_TRUSTED
: > "$COMMAND_LOG"
MOCK_KEYCHAIN_FINGERPRINT=0000000000000000000000000000000000000000000000000000000000000000
_trust_homelab_ca_globally "$user_ca"
grep -Fqx "security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $user_ca" "$COMMAND_LOG" || {
    echo "FAIL: a missing homelab CA was not trusted on macOS" >&2
    exit 1
}

printf 'PASS: homelab CA system trust\n'
