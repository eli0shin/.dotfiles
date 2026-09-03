#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
export MEETILY_APP_PATH="$TEST_ROOT/Applications/Meetily - Actually Free.app"
export MEETILY_STATE_DIR="$TEST_ROOT/state"
export MEETILY_PLIST_BUDDY="$TEST_ROOT/PlistBuddy"
export MEETILY_INSTALLER_NO_MAIN=1
mkdir -p "$HOME" "$TEST_ROOT/artifact/dist"

cat > "$MEETILY_PLIST_BUDDY" <<'SCRIPT'
#!/usr/bin/env bash
cat "${@: -1}"
SCRIPT
chmod +x "$MEETILY_PLIST_BUDDY"

printf 'candidate dmg fixture\n' > "$TEST_ROOT/artifact/dist/Meetily-Actually-Free_0.2.11_aarch64.dmg"
sha=$(shasum -a 256 "$TEST_ROOT/artifact/dist/Meetily-Actually-Free_0.2.11_aarch64.dmg" | awk '{print $1}')
jq -n --arg sha "$sha" '{version:"0.2.11",run_id:"10",dmg_sha256:$sha}' \
    > "$TEST_ROOT/artifact/dist/macos-build-metadata.json"

GH_DOWNLOAD_LOG="$TEST_ROOT/downloads.log"
: > "$GH_DOWNLOAD_LOG"
gh() {
    if [[ "$1" == "api" && "$2" == *'/actions/workflows/'* ]]; then
        cat <<'JSON'
{"workflow_runs":[
  {"id":10,"created_at":"2026-08-28T15:00:00Z","event":"workflow_dispatch","head_branch":"main"},
  {"id":20,"created_at":"2026-08-29T15:00:00Z","event":"workflow_dispatch","head_branch":"main"},
  {"id":30,"created_at":"2026-08-30T15:00:00Z","event":"push","head_branch":"main"}
]}
JSON
    elif [[ "$1" == "api" && "$2" == *'/actions/runs/20/artifacts'* ]]; then
        [[ "${GH_FAIL_ARTIFACT_LOOKUP:-}" != 1 ]] || return 1
        printf ''
    elif [[ "$1" == "api" && "$2" == *'/actions/runs/10/artifacts'* ]]; then
        printf 'meetily-actually-free-0.2.11-macos-aarch64\t101\n'
    elif [[ "$1" == "run" && "$2" == "download" ]]; then
        local destination=''
        while [[ "$#" -gt 0 ]]; do
            if [[ "$1" == "--dir" ]]; then
                destination="$2"
                break
            fi
            shift
        done
        cp -R "$TEST_ROOT/artifact/." "$destination/"
        printf 'download\n' >> "$GH_DOWNLOAD_LOG"
    else
        printf 'Unexpected gh call: %s\n' "$*" >&2
        return 1
    fi
}

hdiutil() {
    if [[ "$1" == "attach" ]]; then
        local mount_dir=''
        while [[ "$#" -gt 0 ]]; do
            if [[ "$1" == "-mountpoint" ]]; then
                mount_dir="$2"
                break
            fi
            shift
        done
        mkdir -p "$mount_dir/Meetily - Actually Free.app/Contents"
        printf '0.2.11\n' > "$mount_dir/Meetily - Actually Free.app/Contents/Info.plist"
    fi
}

ditto() {
    mkdir -p "$2"
    cp -R "$1/." "$2/"
}

# shellcheck disable=SC1091
source "$(dirname "$0")/../scripts/install-meetily-candidate.sh"

GH_FAIL_ARTIFACT_LOOKUP=1
if _latest_candidate >/dev/null 2>&1; then
    echo 'FAIL: artifact API failure selected an older candidate' >&2
    exit 1
fi
unset GH_FAIL_ARTIFACT_LOOKUP

candidate=$(_latest_candidate)
[[ "$candidate" == $'10\tmeetily-actually-free-0.2.11-macos-aarch64\t101' ]] || {
    printf 'FAIL: wrong candidate selected: %s\n' "$candidate" >&2
    exit 1
}

_install_latest_candidate
[[ -d "$MEETILY_APP_PATH" ]] || { echo 'FAIL: app was not installed' >&2; exit 1; }
[[ "$(jq -r .run_id "$MEETILY_STATE_DIR/meetily-candidate.json")" == 10 ]] || {
    echo 'FAIL: candidate run was not recorded' >&2
    exit 1
}
[[ "$(wc -l < "$GH_DOWNLOAD_LOG" | tr -d ' ')" -eq 1 ]] || {
    echo 'FAIL: candidate was not downloaded once' >&2
    exit 1
}

_install_latest_candidate
[[ "$(wc -l < "$GH_DOWNLOAD_LOG" | tr -d ' ')" -eq 1 ]] || {
    echo 'FAIL: installed candidate was downloaded again' >&2
    exit 1
}

manifest_command=$(jq -r '.[] | select(.command == "meetily-actually-free") | .platforms.darwin.install' \
    "$(dirname "$0")/../packages/bash-packages.json")
# shellcheck disable=SC2016 # Compare with the literal manifest command.
[[ "$manifest_command" == '"$DOTFILES_DIR/scripts/install-meetily-candidate.sh"' ]] || {
    echo 'FAIL: package manifest does not use the candidate installer' >&2
    exit 1
}

printf 'PASS: Meetily candidate installer\n'
