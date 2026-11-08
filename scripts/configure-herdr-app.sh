#!/usr/bin/env bash
set -euo pipefail

# Apply only portable preferences; shared.json also holds machine-local mod state.
# Do not use the normal *.base.json merger here: it would discard that state.
config_dir="${1:?Usage: configure-herdr-app.sh <herdr-app config directory>}"
defaults="$config_dir/shared.defaults.json"
state="$config_dir/shared.json"

for file in "$defaults" "$state"; do
    if [[ "$file" == "$state" && ! -e "$file" ]]; then
        continue
    fi
    if ! jq -e -s 'length == 1 and (.[0] | type == "object")' "$file" >/dev/null; then
        echo "Invalid Herdr configuration (expected one JSON object): $file" >&2
        exit 1
    fi
done

tmp=$(mktemp "$config_dir/.shared.json.XXXXXX")
trap 'rm -f "$tmp"' EXIT
if [[ -e "$state" ]]; then
    jq -s '.[0] + .[1]' "$state" "$defaults" > "$tmp"
    # A no-op must not touch the app's state, including while it is running.
    if jq -e -s '.[0] == .[1]' "$state" "$tmp" >/dev/null; then
        exit 0
    fi
else
    cp "$defaults" "$tmp"
fi

# shared.json is read at launch, not hot-reloaded. Editing it underneath a live
# app would be ineffective and its next save could undo our preferences.
if [[ -S "$config_dir/herdr-app.sock" ]]; then
    running=true
    if command -v herdr-app >/dev/null 2>&1; then
        if status_output=$(HERDR_APP_HOME="$config_dir" herdr-app status 2>&1); then
            : # The live app answered.
        elif [[ "$status_output" == *"no Herdr window at "* ]]; then
            running=false # Confirmed connection failure: stale socket.
        fi
    fi
    # A busy/hung-up window (or unavailable CLI) is not proof the app exited.
    if [[ "$running" == true ]]; then
        echo 'Quit Herdr and rerun dot stow to apply the tracked app preferences.' >&2
        exit 1
    fi
fi

mv "$tmp" "$state"
echo 'Configured Herdr: eli layout, no Files/Changes buttons.'
