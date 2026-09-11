#!/usr/bin/env bash

set -euo pipefail

home_dir=$(cd "$(dirname "$0")/../../../.." && pwd)
script="$home_dir/.local/bin/aerospace-close"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/aerospace" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$TEST_LOG"
case "$*" in
  "list-workspaces --focused")
    printf '3\n'
    ;;
  "list-windows --focused --format %{window-id}")
    printf '123\n'
    ;;
  "list-windows --all --format %{window-id}")
    :
    ;;
  "list-windows --workspace 3 --format %{window-id}")
    if [[ "$TEST_SCENARIO" == "remaining-window" ]]; then printf '777\n'; fi
    ;;
esac
MOCK

cat >"$tmp_dir/app-launcher" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'app-launcher %s\n' "$*" >>"$TEST_LOG"
MOCK
chmod +x "$tmp_dir/aerospace" "$tmp_dir/app-launcher" "$script"

run_scenario() {
    local scenario=$1
    local expected=$2
    : >"$tmp_dir/log"
    TEST_LOG="$tmp_dir/log" \
    TEST_SCENARIO="$scenario" \
    AEROSPACE_BIN="$tmp_dir/aerospace" \
    APP_LAUNCHER_BIN="$tmp_dir/app-launcher" \
    AEROSPACE_CLOSE_FOCUS_DELAY=0 \
    "$script"
    if ! grep -Fxq "$expected" "$tmp_dir/log"; then
        printf 'FAIL: %s did not run: %s\n' "$scenario" "$expected" >&2
        printf '%s\n' 'Actual commands:' >&2
        cat "$tmp_dir/log" >&2
        exit 1
    fi
}

run_scenario empty-workspace "app-launcher --focus-sink"
run_scenario empty-workspace "close --window-id 123"
run_scenario remaining-window "focus --window-id 777"

: >"$tmp_dir/log"
TEST_LOG="$tmp_dir/log" \
TEST_SCENARIO=empty-workspace \
AEROSPACE_BIN="$tmp_dir/aerospace" \
APP_LAUNCHER_BIN="$tmp_dir/app-launcher" \
AEROSPACE_CLOSE_FOCUS_DELAY=0 \
"$script"
if grep -Eq '^workspace (next|prev|[0-9]+)$' "$tmp_dir/log"; then
    printf 'FAIL: empty workspace repair must not show another workspace\n' >&2
    cat "$tmp_dir/log" >&2
    exit 1
fi

focus_sink_line=$(grep -nFx 'app-launcher --focus-sink' "$tmp_dir/log" | cut -d: -f1)
close_line=$(grep -nFx 'close --window-id 123' "$tmp_dir/log" | cut -d: -f1)
if [[ -z "$focus_sink_line" || -z "$close_line" || "$focus_sink_line" -ge "$close_line" ]]; then
    printf 'FAIL: focus sink must activate before the window closes\n' >&2
    cat "$tmp_dir/log" >&2
    exit 1
fi

echo "AeroSpace close tests passed"
