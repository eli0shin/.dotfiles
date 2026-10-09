#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
work_dir=$(mktemp -d)
pids=()
cleanup() {
  if (( ${#pids[@]} )); then
    kill -KILL "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir -p "$work_dir/bin" "$work_dir/release/new/resources/src/assets"
cat > "$work_dir/release/new/open-whispr" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$work_dir/release/new/open-whispr"
printf 'icon\n' > "$work_dir/release/new/resources/src/assets/icon.png"
tar -czf "$work_dir/release.tar.gz" -C "$work_dir/release" new
cat > "$work_dir/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while [[ "$1" != --dir ]]; do shift; done
cp "$TEST_ARCHIVE" "$2/OpenWhispr-test-linux-x64.tar.gz"
EOF
chmod +x "$work_dir/bin/gh"
export TEST_ARCHIVE="$work_dir/release.tar.gz"
export PATH="$work_dir/bin:$PATH"

new_home() {
  export HOME="$work_dir/$1"
  export XDG_CACHE_HOME="$HOME/.cache" XDG_CONFIG_HOME="$HOME/.config"
  app_dir="$HOME/.local/opt/openwhispr/app"
  mkdir -p "$app_dir"
  printf 'old installation\n' > "$app_dir/marker"
}

# Real processes with the same argv[0] forms Electron uses. An unrelated copy
# must survive even if its command line mentions the installed executable.
new_home graceful
cp /bin/sleep "$app_dir/open-whispr-app"
bash -c 'exec -a "$1" "$2" 60' -- "$app_dir/open-whispr" "$app_dir/open-whispr-app" &
main_pid=$!
pids+=("$main_pid")
bash -c 'exec -a /proc/self/exe "$1" 60' -- "$app_dir/open-whispr-app" &
child_pid=$!
pids+=("$child_pid")
cp /bin/sleep "$work_dir/unrelated"
bash -c 'exec -a "$1" "$2" 60' -- "$app_dir/open-whispr-app" "$work_dir/unrelated" &
unrelated_pid=$!
pids+=("$unrelated_pid")
for pid in "$main_pid" "$child_pid" "$unrelated_pid"; do
  for _ in {1..100}; do
    [[ "$(readlink "/proc/$pid/exe")" != "$(readlink -f /bin/bash)" ]] && break
    sleep 0.01
  done
done
bash "$REPO_ROOT/scripts/install-openwhispr-fork.sh" > "$work_dir/graceful.log" 2>&1
if kill -0 "$main_pid" 2>/dev/null || kill -0 "$child_pid" 2>/dev/null; then
  printf 'FAIL: a fork process survived the update\n' >&2
  exit 1
fi
kill -0 "$unrelated_pid"
[[ ! -e "$app_dir/marker" && -x "$app_dir/open-whispr" ]]
printf 'PASS: stops renamed main process and /proc/self/exe child, preserves unrelated process\n'

# Refuse to replace the installation when graceful shutdown does not finish.
new_home stubborn
cp /bin/bash "$app_dir/open-whispr-app"
bash -c 'exec -a "$1" "$2" -c '\''trap "" TERM; touch "$1"; while :; do sleep 0.1; done'\'' -- "$3"' \
  -- "$app_dir/open-whispr" "$app_dir/open-whispr-app" "$work_dir/ready" &
stubborn_pid=$!
pids+=("$stubborn_pid")
for _ in {1..100}; do
  [[ -e "$work_dir/ready" ]] && break
  sleep 0.01
done
[[ -e "$work_dir/ready" ]]
if bash "$REPO_ROOT/scripts/install-openwhispr-fork.sh" > "$work_dir/stubborn.log" 2>&1; then
  printf 'FAIL: installer replaced files while OpenWhispr remained running\n' >&2
  exit 1
fi
kill -0 "$stubborn_pid"
[[ "$(< "$app_dir/marker")" == 'old installation' ]]
[[ ! -e "$HOME/.local/bin/open-whispr" ]]
grep -q 'OpenWhispr is still running' "$work_dir/stubborn.log"
[[ -z "$(find "$XDG_CACHE_HOME/dotfiles" -mindepth 1 -print -quit)" ]]
printf 'PASS: shutdown timeout leaves installation unchanged and cleans temporary download\n'

new_home stopped
bash "$REPO_ROOT/scripts/install-openwhispr-fork.sh" > "$work_dir/stopped.log" 2>&1
[[ ! -e "$app_dir/marker" && -x "$app_dir/open-whispr" ]]
printf 'PASS: installs when no fork process is running\n'
