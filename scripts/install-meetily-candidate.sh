#!/usr/bin/env bash
set -euo pipefail

MEETILY_REPO="${MEETILY_REPO:-TylerBuza/Meetily-ActuallyFree}"
MEETILY_WORKFLOW="${MEETILY_WORKFLOW:-build-macos.yml}"
MEETILY_APP_PATH="${MEETILY_APP_PATH:-$HOME/Applications/Meetily - Actually Free.app}"
MEETILY_STATE_DIR="${MEETILY_STATE_DIR:-$HOME/Library/Application Support/dotfiles}"
MEETILY_STATE_FILE="$MEETILY_STATE_DIR/meetily-candidate.json"
MEETILY_PLIST_BUDDY="${MEETILY_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"

_latest_candidate() {
    local runs_json run_id artifact
    runs_json=$(gh api \
        "repos/$MEETILY_REPO/actions/workflows/$MEETILY_WORKFLOW/runs?branch=main&status=success&per_page=100")

    while IFS= read -r run_id; do
        if ! artifact=$(gh api "repos/$MEETILY_REPO/actions/runs/$run_id/artifacts?per_page=100" --jq '
            .artifacts
            | map(select((.expired | not) and (.name | test("^meetily-actually-free-[0-9]+\\.[0-9]+\\.[0-9]+-macos-aarch64$"))))
            | first
            | if . == null then empty else [.name, .id] | @tsv end
        '); then
            echo "Failed to inspect artifacts for Meetily Actions run $run_id" >&2
            return 1
        fi
        if [[ -n "$artifact" ]]; then
            printf '%s\t%s\t%s\n' "$run_id" "${artifact%%$'\t'*}" "${artifact#*$'\t'}"
            return 0
        fi
    done < <(jq -r '
        .workflow_runs
        | sort_by(.created_at)
        | reverse[]
        | select(.event == "workflow_dispatch" and .head_branch == "main")
        | .id
    ' <<< "$runs_json")

    echo "No successful, unexpired Meetily macOS candidate was found" >&2
    return 1
}

_installed_candidate_matches() {
    local run_id="$1"
    local version="$2"
    local installed_run installed_version

    [[ -d "$MEETILY_APP_PATH" && -f "$MEETILY_STATE_FILE" ]] || return 1
    installed_run=$(jq -r '.run_id // empty' "$MEETILY_STATE_FILE")
    installed_version=$("$MEETILY_PLIST_BUDDY" -c 'Print :CFBundleShortVersionString' \
        "$MEETILY_APP_PATH/Contents/Info.plist" 2>/dev/null || true)

    [[ "$installed_run" == "$run_id" && "$installed_version" == "$version" ]]
}

_install_latest_candidate() (
    local candidate run_id artifact_name artifact_id
    local tmp_dir mount_dir dmg_path metadata_path expected_sha actual_sha version source_app
    local dmg_files=() metadata_files=() mounted=false

    candidate=$(_latest_candidate)
    IFS=$'\t' read -r run_id artifact_name artifact_id <<< "$candidate"

    version=${artifact_name#meetily-actually-free-}
    version=${version%-macos-aarch64}
    if _installed_candidate_matches "$run_id" "$version"; then
        echo "Meetily candidate $version from Actions run $run_id is already installed"
        return 0
    fi

    tmp_dir=$(mktemp -d)
    mount_dir=$(mktemp -d)
    # shellcheck disable=SC2329 # Invoked by the EXIT trap.
    cleanup() {
        if [[ "$mounted" == true ]]; then
            hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
        fi
        rm -rf "$tmp_dir" "$mount_dir"
    }
    trap cleanup EXIT

    echo "Downloading Meetily macOS candidate from Actions run $run_id..."
    gh run download "$run_id" --repo "$MEETILY_REPO" --name "$artifact_name" --dir "$tmp_dir"

    while IFS= read -r file; do dmg_files[${#dmg_files[@]}]="$file"; done \
        < <(find "$tmp_dir" -type f -name 'Meetily-Actually-Free_*_aarch64.dmg')
    while IFS= read -r file; do metadata_files[${#metadata_files[@]}]="$file"; done \
        < <(find "$tmp_dir" -type f -name 'macos-build-metadata.json')

    if [[ "${#dmg_files[@]}" -ne 1 || "${#metadata_files[@]}" -ne 1 ]]; then
        echo "Candidate must contain exactly one DMG and one metadata file" >&2
        return 1
    fi
    dmg_path="${dmg_files[0]}"
    metadata_path="${metadata_files[0]}"

    if [[ "$(jq -r '.run_id' "$metadata_path")" != "$run_id" ]]; then
        echo "Candidate metadata does not match Actions run $run_id" >&2
        return 1
    fi
    if [[ "$(jq -r '.version' "$metadata_path")" != "$version" ]]; then
        echo "Candidate metadata version does not match artifact $artifact_name" >&2
        return 1
    fi
    expected_sha=$(jq -r '.dmg_sha256' "$metadata_path")
    actual_sha=$(shasum -a 256 "$dmg_path" | awk '{print $1}')
    if [[ "$actual_sha" != "$expected_sha" ]]; then
        echo "Candidate DMG checksum does not match its build metadata" >&2
        return 1
    fi

    hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_dir" >/dev/null
    mounted=true
    source_app="$mount_dir/Meetily - Actually Free.app"
    if [[ ! -d "$source_app" ]]; then
        echo "Candidate DMG does not contain the expected application" >&2
        return 1
    fi
    if [[ "$("$MEETILY_PLIST_BUDDY" -c 'Print :CFBundleShortVersionString' "$source_app/Contents/Info.plist")" != "$version" ]]; then
        echo "Candidate application version does not match its build metadata" >&2
        return 1
    fi

    mkdir -p "$(dirname "$MEETILY_APP_PATH")"
    rm -rf "$MEETILY_APP_PATH"
    ditto "$source_app" "$MEETILY_APP_PATH"
    mkdir -p "$MEETILY_STATE_DIR"
    jq -n \
        --arg run_id "$run_id" \
        --arg artifact_id "$artifact_id" \
        --arg version "$version" \
        '{run_id: $run_id, artifact_id: $artifact_id, version: $version}' > "$MEETILY_STATE_FILE"

    echo "Installed Meetily candidate $version from Actions run $run_id"
)

if [[ "${MEETILY_INSTALLER_NO_MAIN:-}" != 1 ]]; then
    _install_latest_candidate
fi
