#!/usr/bin/env bash
set -euo pipefail

readonly test_id="$$"
readonly tmux_session="herdr-keyboard-paste-test-${test_id}"
readonly fish_session="fish-keyboard-paste-control-${test_id}"
readonly herdr_session="keyboard-paste-test-${test_id}"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/herdr-keyboard-paste-${test_id}.XXXXXX")
readonly test_root
readonly source_file="$test_root/source.txt"
readonly nvim_put_file="$test_root/nvim-put.txt"
readonly nvim_state="$test_root/nvim-state"
readonly config_file="$test_root/config.toml"
readonly ctrl_v_line="HERDR_CTRL_V_PASTE_${test_id}_7F3A"
readonly ctrl_v_ready="HERDR_CTRL_V_COPY_READY_${test_id}"
readonly ctrl_shift_v_line="HERDR_CTRL_SHIFT_V_PASTE_${test_id}_9B2C"
readonly ctrl_shift_v_ready="HERDR_CTRL_SHIFT_V_COPY_READY_${test_id}"
readonly fish_ctrl_v_line="FISH_CTRL_V_PASTE_${test_id}_4D1E"
readonly fish_ctrl_v_ready="FISH_CTRL_V_COPY_READY_${test_id}"
readonly fish_ctrl_shift_v_line="FISH_CTRL_SHIFT_V_PASTE_${test_id}_6A8F"
readonly fish_ctrl_shift_v_ready="FISH_CTRL_SHIFT_V_COPY_READY_${test_id}"

export HERDR_CONFIG_PATH="$config_file"

# shellcheck disable=SC2329 # Invoked by the EXIT trap.
cleanup() {
  herdr session stop "$herdr_session" >/dev/null 2>&1 || true
  herdr session delete "$herdr_session" >/dev/null 2>&1 || true
  tmux kill-session -t "$tmux_session" >/dev/null 2>&1 || true
  tmux kill-session -t "$fish_session" >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT

wait_for_server() {
  local status

  for _ in {1..200}; do
    status=$(herdr --session "$herdr_session" status server --json 2>/dev/null || true)
    if jq -e '(.running // .server.running) == true' <<<"$status" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.05
  done

  echo "FAIL: isolated Herdr server did not start" >&2
  return 1
}

focused_pane_id() {
  local panes

  for _ in {1..200}; do
    panes=$(herdr --session "$herdr_session" pane list 2>/dev/null || true)
    if jq -er '.result.panes[] | select(.focused) | .pane_id' <<<"$panes" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done

  echo "FAIL: isolated Herdr session did not expose a focused pane" >&2
  return 1
}

wait_for_copy() {
  local pane_id=$1
  local ready_marker=$2
  local screen

  for _ in {1..200}; do
    screen=$(herdr --session "$herdr_session" pane read "$pane_id" --source recent 2>/dev/null || true)
    if grep -Fxq "$ready_marker" <<<"$screen"; then
      return 0
    fi
    sleep 0.05
  done

  echo "FAIL: Neovim yank did not complete" >&2
  return 1
}

yank_line() {
  local pane_id=$1
  local line=$2
  local ready_marker=$3

  printf '%s\n' "$line" >"$source_file"
  herdr --session "$herdr_session" pane run "$pane_id" \
    "XDG_STATE_HOME='$nvim_state' nvim --headless '$source_file' -c 'normal! yy' -c 'qa'; printf '%s\\n' '$ready_marker'" \
    >/dev/null
  wait_for_copy "$pane_id" "$ready_marker"
}

wait_for_tmux_line() {
  local target=$1
  local expected=$2
  local screen

  for _ in {1..200}; do
    screen=$(tmux capture-pane -p -t "$target" -S -100 2>/dev/null || true)
    if grep -Fxq "$expected" <<<"$screen"; then
      return 0
    fi
    sleep 0.05
  done

  echo "FAIL: Fish control yank did not complete" >&2
  return 1
}

wait_for_file_line() {
  local file=$1
  local expected=$2

  for _ in {1..200}; do
    if [[ -f $file ]] && grep -Fxq "$expected" "$file"; then
      return 0
    fi
    sleep 0.05
  done

  echo "FAIL: reopened Neovim did not put the yanked line" >&2
  return 1
}

yank_line_in_tmux() {
  local target=$1
  local line=$2
  local ready_marker=$3

  printf '%s\n' "$line" >"$source_file"
  tmux send-keys -l -t "$target" \
    "XDG_STATE_HOME='$nvim_state' nvim --headless '$source_file' -c 'normal! yy' -c 'qa'; printf '%s\\n' '$ready_marker'"
  tmux send-keys -t "$target" Enter
  wait_for_tmux_line "$target" "$ready_marker"
}

send_csi_u_key() {
  local target=$1
  local modifier=$2

  tmux send-keys -t "$target" Escape
  tmux send-keys -l -t "$target" "[118;${modifier}u"
  sleep 0.25
}

mkdir -p "$nvim_state"
printf '%s\n' 'onboarding = false' >"$config_file"

tmux new-session -d -s "$tmux_session" -x 100 -y 30 \
  "HERDR_CONFIG_PATH='$config_file' exec herdr --session '$herdr_session'"
wait_for_server
pane_id=$(focused_pane_id)

tmux new-session -d -s "$fish_session" -x 100 -y 30 'exec fish'
sleep 0.25

yank_line_in_tmux "$fish_session" "$fish_ctrl_v_line" "$fish_ctrl_v_ready"
send_csi_u_key "$fish_session" 5
fish_ctrl_v_screen=$(tmux capture-pane -p -t "$fish_session" -S -100)
fish_ctrl_v_inserted=no
grep -Fq "$fish_ctrl_v_line" <<<"$fish_ctrl_v_screen" && fish_ctrl_v_inserted=yes
tmux send-keys -t "$fish_session" C-c
sleep 0.1

yank_line_in_tmux "$fish_session" "$fish_ctrl_shift_v_line" "$fish_ctrl_shift_v_ready"
send_csi_u_key "$fish_session" 6
fish_ctrl_shift_v_screen=$(tmux capture-pane -p -t "$fish_session" -S -100)
fish_ctrl_shift_v_inserted=no
grep -Fq "$fish_ctrl_shift_v_line" <<<"$fish_ctrl_shift_v_screen" && fish_ctrl_shift_v_inserted=yes

# Verify that a new Neovim process can restore and put the preceding yank.
tmux send-keys -t "$fish_session" C-c
tmux send-keys -l -t "$fish_session" \
  "XDG_STATE_HOME='$nvim_state' nvim --headless -c 'enew' -c 'normal! p' -c 'wq! $nvim_put_file'"
tmux send-keys -t "$fish_session" Enter
nvim_put_restored=no
if wait_for_file_line "$nvim_put_file" "$fish_ctrl_shift_v_line"; then
  nvim_put_restored=yes
fi

# Seed each Herdr case through the ordinary Neovim yank that succeeds outside Herdr.
# The copied text is not present in the command itself, so it cannot produce a
# false-positive pane read.
yank_line "$pane_id" "$ctrl_v_line" "$ctrl_v_ready"
send_csi_u_key "$tmux_session" 5
ctrl_v_screen=$(herdr --session "$herdr_session" pane read "$pane_id" --source visible)
ctrl_v_inserted=no
grep -Fq "$ctrl_v_line" <<<"$ctrl_v_screen" && ctrl_v_inserted=yes

# Cancel any quoted-insert or partial shell input before the second case.
herdr --session "$herdr_session" pane send-keys "$pane_id" ctrl+c >/dev/null
sleep 0.1

yank_line "$pane_id" "$ctrl_shift_v_line" "$ctrl_shift_v_ready"
send_csi_u_key "$tmux_session" 6
ctrl_shift_v_screen=$(herdr --session "$herdr_session" pane read "$pane_id" --source visible)
ctrl_shift_v_inserted=no
grep -Fq "$ctrl_shift_v_line" <<<"$ctrl_shift_v_screen" && ctrl_shift_v_inserted=yes

printf 'Fish Ctrl+V inserted=%s\n' "$fish_ctrl_v_inserted"
printf 'Fish Ctrl+Shift+V inserted=%s\n' "$fish_ctrl_shift_v_inserted"
printf 'Reopened Neovim put restored=%s\n' "$nvim_put_restored"
printf 'Herdr Ctrl+V inserted=%s\n' "$ctrl_v_inserted"
printf 'Herdr Ctrl+Shift+V inserted=%s\n' "$ctrl_shift_v_inserted"

if [[ $nvim_put_restored == no ]]; then
  echo "FAIL: reopened Neovim could not restore and put the yanked line" >&2
  exit 1
fi

if [[ $ctrl_v_inserted == yes || $ctrl_shift_v_inserted == yes ]]; then
  exit 0
fi

echo "FAIL: neither Herdr Ctrl+V nor Ctrl+Shift+V inserted its Neovim-yanked line" >&2
printf '%s\n' '--- Ctrl+V focused pane ---' >&2
printf '%s\n' "$ctrl_v_screen" >&2
printf '%s\n' '--- Ctrl+Shift+V focused pane ---' >&2
printf '%s\n' "$ctrl_shift_v_screen" >&2
exit 1
