#!/usr/bin/env bash

set -euo pipefail

AEROSPACE=$(command -v aerospace)
SKETCHYBAR=$(command -v sketchybar)

if [[ $# -gt 0 ]]; then
    exec "$AEROSPACE" workspace "$1"
fi

focused_workspace=${FOCUSED_WORKSPACE:-$("$AEROSPACE" list-workspaces --focused)}
occupied_workspaces=$'\n'"$("$AEROSPACE" list-workspaces --monitor all --empty no)"$'\n'

updates=()
for workspace in {1..10}; do
    item="space.$workspace"
    label="$workspace"
    [[ "$workspace" == "10" ]] && label="0"

    if [[ "$occupied_workspaces" == *$'\n'"$workspace"$'\n'* ]]; then
        workspace_color=0xffc8c8c8
    else
        workspace_color=0xff686868
    fi

    if [[ "$workspace" == "$focused_workspace" ]]; then
        updates+=(
            --set "$item"
            drawing=on
            label="$label"
            label.font="Menlo:Regular:12.0"
            label.color="$workspace_color"
            label.y_offset=0
            background.drawing=on
            background.color=0x00000000
            background.border_color="$workspace_color"
            background.border_width=1
            background.height=18
            background.corner_radius=5
            background.x_offset=0
            background.y_offset=-1
        )
    elif [[ "$occupied_workspaces" == *$'\n'"$workspace"$'\n'* ]]; then
        updates+=(
            --set "$item"
            drawing=on
            label="$label"
            label.font="Menlo:Regular:12.0"
            label.color=0xffc8c8c8
            label.y_offset=0
            background.drawing=off
        )
    elif (( workspace <= 5 )); then
        updates+=(
            --set "$item"
            drawing=on
            label="$label"
            label.font="Menlo:Regular:12.0"
            label.color=0xff686868
            label.y_offset=0
            background.drawing=off
        )
    else
        updates+=(--set "$item" drawing=off)
    fi
done

exec "$SKETCHYBAR" "${updates[@]}"
