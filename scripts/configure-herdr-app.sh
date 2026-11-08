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
    # Managed keys win, except a welcome the user already dismissed either way.
    jq -s '.[1] + .[0] + (.[1] | del(."frame.welcomed"))' "$state" "$defaults" > "$tmp"
    # A no-op must not touch the app's state, including while it is running.
    if jq -e -s '.[0] == .[1]' "$state" "$tmp" >/dev/null; then
        exit 0
    fi
else
    cp "$defaults" "$tmp"
fi

app() { HERDR_APP_HOME="$config_dir" herdr-app "$@"; }

# The running app holds shared.json in memory: it reads it once at launch and
# rewrites it on every shared change, so a file edit would be ignored and then
# undone. Set the values inside the app instead; it persists them itself.
apply_live() {
    local changes layout rest i
    changes=$(jq -c -s '.[0] as $old | .[1] | with_entries(select(.value != $old[.key]))' \
        <(if [[ -e "$state" ]]; then cat "$state"; else echo '{}'; fi) "$tmp")
    layout=$(jq -r '.layout // empty' <<<"$changes")
    rest=$(jq -c 'del(.layout)' <<<"$changes")
    # layout.switch both shows the layout and persists it as shared "layout".
    if [[ -n "$layout" ]]; then
        app do layout.switch --name "$layout" >/dev/null 2>&1 || return 1
    fi
    if [[ "$rest" != '{}' ]]; then
        # navigator-status (in the eli layout) sets them; allow it to load.
        for ((i = 0; ; i++)); do
            app do "navigator-status.set-shared:$rest" >/dev/null 2>&1 && break
            ((i < 20)) || return 1
            sleep 0.25
        done
    fi
    # The app saves asynchronously; confirm the values actually landed.
    for ((i = 0; i < 20; i++)); do
        if [[ -e "$state" ]] && jq -e --argjson want "$changes" \
            '. as $s | $want | to_entries | all(.value == $s[.key])' "$state" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.25
    done
    return 1
}

if [[ -S "$config_dir/herdr-app.sock" ]]; then
    running=true
    if command -v herdr-app >/dev/null 2>&1; then
        if status_output=$(HERDR_APP_HOME="$config_dir" herdr-app status 2>&1); then
            : # The live app answered.
        elif [[ "$status_output" == *"no Herdr window at "* ]]; then
            running=false # Confirmed connection failure: stale socket.
        fi
    fi
    # A busy/hung-up window (or unavailable CLI) is not proof the app exited,
    # so never write the file under it. Never block the rest of stow either.
    if [[ "$running" == true ]]; then
        if command -v herdr-app >/dev/null 2>&1 && apply_live; then
            echo 'Configured running Herdr: eli layout, no Files/Changes buttons.'
        else
            echo 'Could not apply tracked preferences to the running Herdr; rerun dot stow once it responds.' >&2
        fi
        exit 0
    fi
fi

mv "$tmp" "$state"
echo 'Configured Herdr: eli layout, no Files/Changes buttons.'
