#!/usr/bin/env bash

set -euo pipefail

sketchybar --set "$NAME" label="$(date '+%a %b %d  %-I:%M %p')"
