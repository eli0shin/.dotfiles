#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
readonly repo_root
readonly script="$repo_root/home/.local/bin/herdr-lumen-file-nav"
test_root=$(mktemp -d)
readonly test_root
trap 'rm -rf "$test_root"' EXIT

readonly command_log="$test_root/commands.log"
readonly herdr_mock="$test_root/herdr"
cat >"$herdr_mock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$COMMAND_LOG"
if [[ "$1 $2" == "pane process-info" ]]; then
    printf '%s\n' "$PROCESS_INFO"
fi
MOCK
chmod +x "$herdr_mock" "$script"

run_navigation() {
    local process_info=$1
    local direction=$2
    : >"$command_log"
    COMMAND_LOG="$command_log" \
        PROCESS_INFO="$process_info" \
        HERDR_BIN_PATH="$herdr_mock" \
        HERDR_ACTIVE_PANE_ID=42 \
        "$script" "$direction"
}

run_navigation '{"processes":[{"name":"fish"},{"name":"lumen"}]}' next
grep -Fxq 'pane send-keys 42 ctrl+j' "$command_log" || {
    echo 'FAIL: next did not send Ctrl+J to Lumen' >&2
    exit 1
}

run_navigation '{"processes": [{"name": "lumen"}]}' previous
grep -Fxq 'pane send-keys 42 ctrl+k' "$command_log" || {
    echo 'FAIL: previous did not send Ctrl+K to Lumen' >&2
    exit 1
}

run_navigation '{"processes":[{"name":"nvim"}]}' next
grep -Fxq 'pane send-keys 42 alt+j' "$command_log" || {
    echo 'FAIL: next did not preserve Alt+J outside Lumen' >&2
    exit 1
}

run_navigation '{"processes":[{"name":"fish"}]}' previous
grep -Fxq 'pane send-keys 42 alt+k' "$command_log" || {
    echo 'FAIL: previous did not preserve Alt+K outside Lumen' >&2
    exit 1
}

if COMMAND_LOG="$command_log" PROCESS_INFO='{}' HERDR_BIN_PATH="$herdr_mock" \
    HERDR_ACTIVE_PANE_ID=42 "$script" sideways 2>/dev/null; then
    echo 'FAIL: invalid direction succeeded' >&2
    exit 1
fi

printf 'PASS: Herdr Lumen file navigation\n'
