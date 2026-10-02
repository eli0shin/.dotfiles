#!/usr/bin/env bash

set -euo pipefail

AEROSPACE=$(command -v aerospace)
SKETCHYBAR=$(command -v sketchybar)

if [[ $# -gt 0 ]]; then
    exec "$AEROSPACE" workspace "$1"
fi

# AeroSpace does not report which window an unfocused workspace would focus,
# so remember the last focused window of each workspace. Window IDs do not
# survive a restart, so the per-boot temporary directory holds the state.
state_file="${TMPDIR:-/tmp}/sketchybar-aerospace-workspace-windows"

# Updates overlap when focus changes quickly. Serialize them so one update
# does not overwrite the state or bar of a newer one. A lock that outlives its
# timeout belongs to an interrupted update and is taken over.
lock_dir="$state_file.lock"
for _ in {1..100}; do
    mkdir "$lock_dir" 2>/dev/null && break
    sleep 0.01
done
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

windows=$("$AEROSPACE" list-windows --monitor all --format '%{window-id}|%{workspace}|%{app-bundle-id}')

# No window is focused on an empty workspace, which AeroSpace reports as an
# error.
if focused_window=$("$AEROSPACE" list-windows --focused --format '%{window-id}|%{workspace}' 2>/dev/null); then
    focused_window_id=${focused_window%%|*}
    focused_workspace=${focused_window#*|}
else
    focused_window_id=
    focused_workspace=$("$AEROSPACE" list-workspaces --focused)
fi

# Indexed arrays keyed by workspace number or window ID.
window_workspace=()
window_app=()
first_window=()
remembered_window=()

while IFS='|' read -r window_id workspace app; do
    [[ "$window_id" =~ ^[0-9]+$ && "$workspace" =~ ^([1-9]|10)$ ]] || continue
    window_workspace[window_id]=$workspace
    window_app[window_id]=$app
    [[ -n "${first_window[workspace]:-}" ]] || first_window[workspace]=$window_id
done <<< "$windows"

if [[ -f "$state_file" ]]; then
    while read -r workspace window_id; do
        [[ "$workspace" =~ ^([1-9]|10)$ && "$window_id" =~ ^[0-9]+$ ]] || continue
        remembered_window[workspace]=$window_id
    done < "$state_file"
fi

# The window from the focus event may already have lost focus, so remember it
# before the currently focused window.
for window_id in "${FOCUSED_WINDOW_ID:-}" "$focused_window_id"; do
    [[ "$window_id" =~ ^[0-9]+$ ]] || continue
    workspace=${window_workspace[window_id]:-}
    if [[ -n "$workspace" ]]; then
        remembered_window[workspace]=$window_id
    fi
done

state=""
updates=()
for workspace in {1..10}; do
    item="space.$workspace"

    # Fall back to any window on the workspace when the remembered window
    # closed or moved to another workspace.
    window_id=${remembered_window[workspace]:-}
    if [[ -z "$window_id" || "${window_workspace[window_id]:-}" != "$workspace" ]]; then
        window_id=${first_window[workspace]:-}
    fi

    app=""
    if [[ -n "$window_id" ]]; then
        state+="$workspace $window_id"$'\n'
        app=${window_app[window_id]}
        workspace_color=0xffc8c8c8
    else
        workspace_color=0xff686868
    fi

    if [[ -z "$window_id" && "$workspace" != "$focused_workspace" ]] && (( workspace > 5 )); then
        updates+=(--set "$item" drawing=off)
        continue
    fi

    updates+=(--set "$item" drawing=on icon.color="$workspace_color")

    if [[ "$workspace" == "$focused_workspace" ]]; then
        updates+=(icon.background.drawing=on icon.background.border_color="$workspace_color")
    else
        updates+=(icon.background.drawing=off)
    fi

    if [[ -n "$app" ]]; then
        updates+=(label.drawing=on label.background.image="app.$app" padding_right=5)
    else
        updates+=(label.drawing=off padding_right=1)
    fi
done

state_tmp=$(mktemp "$state_file.XXXXXX")
printf '%s' "$state" > "$state_tmp"
mv "$state_tmp" "$state_file"

"$SKETCHYBAR" "${updates[@]}"
