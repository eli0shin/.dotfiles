#!/usr/bin/env bash
# Checks home/.config/fish/conf.d/hc-pi-resume.fish with fake hc and pi.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
readonly hook="$repo_root/home/.config/fish/conf.d/hc-pi-resume.fish"
test_root=$(mktemp -d)
readonly test_root
trap 'rm -rf "$test_root"' EXIT

readonly bin="$test_root/bin"
readonly calls="$test_root/calls"
readonly markers="$test_root/state/dotfiles/hc-pi"
readonly session="$test_root/session.jsonl"
mkdir -p "$bin" "$markers"
: >"$session"

# hc get prints LABELS as the terminal's labels; every call is logged.
cat >"$bin/hc" <<'MOCK'
#!/usr/bin/env bash
printf 'hc %s\n' "$*" >>"$CALLS"
if [[ $1 == get ]]; then
    printf '{"address":"%s","labels":%s}\n' "$2" "$LABELS"
fi
MOCK
# pi does what hc-session-label.ts does: it leaves a marker for its shell.
cat >"$bin/pi" <<'MOCK'
#!/usr/bin/env bash
printf 'pi %s shell=%s\n' "$*" "$DOTFILES_HC_SHELL" >>"$CALLS"
: >"$XDG_STATE_HOME/dotfiles/hc-pi/$DOTFILES_HC_SHELL"
MOCK
chmod +x "$bin/hc" "$bin/pi"

fail() {
    echo "FAIL: $1" >&2
    printf 'calls:\n%s\n' "$(cat "$calls")" >&2
    exit 1
}

# Runs the hook in an interactive fish, then fires PROMPTS prompt events.
# Extra arguments are environment assignments.
run_shell() {
    local labels=$1 prompts=$2
    shift 2
    : >"$calls"
    env -u DOTFILES_HC_SHELL PATH="$bin:$PATH" CALLS="$calls" LABELS="$labels" \
        XDG_STATE_HOME="$test_root/state" HC_TERMINAL_ID=t7 "$@" \
        fish --no-config -i -c "source '$hook'; for i in (seq $prompts); emit fish_prompt; end; echo \"token \$DOTFILES_HC_SHELL\" >>'$calls'" \
        </dev/null >/dev/null 2>&1
}

# A new terminal: one look at its labels, nothing to resume, a fresh token.
run_shell '{}' 2
[[ $(grep -c '^hc get t7 --json$' "$calls") == 1 ]] || fail 'a new terminal did not read its labels exactly once'
grep -q '^pi ' "$calls" && fail 'a new terminal started pi'
grep -Eq '^token t7-[0-9]+-[0-9]+$' "$calls" || fail 'a new terminal got no token'

# A reopened terminal: resume the session, drop the old marker, and clear the
# label once pi returns.
: >"$markers/t7-1-1"
run_shell "{\"dotfiles.pi_session\":\"$session\",\"dotfiles.pi_shell\":\"t7-1-1\"}" 1
token=$(sed -n 's/^token //p' "$calls")
grep -Fxq "pi --session $session shell=$token" "$calls" || fail 'a reopened terminal did not resume its session'
[[ -e $markers/t7-1-1 ]] && fail 'the old marker was left behind'
grep -Fxq 'hc label t7 dotfiles.pi_session= dotfiles.pi_shell=' "$calls" || fail 'the label outlived the resumed pi'
[[ -e $markers/$token ]] && fail 'the new marker outlived the resumed pi'

# pi started directly by hc run has no shell token, and is resumed too.
run_shell "{\"dotfiles.pi_session\":\"$session\"}" 1
grep -q "^pi --session $session " "$calls" || fail 'a pi without a shell token was not resumed'

# A session file that is gone: forget it instead of starting pi.
run_shell "{\"dotfiles.pi_session\":\"$test_root/gone.jsonl\",\"dotfiles.pi_shell\":\"t7-1-1\"}" 1
grep -q '^pi ' "$calls" && fail 'pi started for a missing session file'
grep -Fxq 'hc label t7 dotfiles.pi_session= dotfiles.pi_shell=' "$calls" || fail 'the label of a missing session was kept'

# A shell that replaced the first one with exec (same pid, same token): pi
# returned to it, so it clears the label without looking for a resume.
run_exec_shell() {
    : >"$calls"
    env -u DOTFILES_HC_SHELL PATH="$bin:$PATH" CALLS="$calls" LABELS='{}' \
        XDG_STATE_HOME="$test_root/state" HC_TERMINAL_ID=t7 MARKERS="$markers" HOOK="$hook" \
        bash -c 'export DOTFILES_HC_SHELL=t7-$$-9; : >"$MARKERS/$DOTFILES_HC_SHELL"
            exec fish --no-config -i -c "source \"$HOOK\"; emit fish_prompt"' </dev/null >/dev/null 2>&1
}
run_exec_shell
grep -q '^hc get' "$calls" && fail 'an exec-replaced shell looked for a resume'
grep -Fxq 'hc label t7 dotfiles.pi_session= dotfiles.pi_shell=' "$calls" || fail 'an exec-replaced shell kept the label of the pi it ran'
compgen -G "$markers/t7-*-9" >/dev/null && fail 'an exec-replaced shell kept its marker'

# A nested shell inherits the token of the shell it runs in and does nothing,
# even while a marker says pi is labelled under that token.
: >"$markers/t7-1-2"
run_shell "{\"dotfiles.pi_session\":\"$session\"}" 1 DOTFILES_HC_SHELL=t7-1-2
grep -Fxq 'token t7-1-2' "$calls" || fail 'a nested shell changed the token'
grep -q '^hc ' "$calls" && fail 'a nested shell called hc'
grep -q '^pi ' "$calls" && fail 'a nested shell started pi'
[[ -e $markers/t7-1-2 ]] || fail 'a nested shell removed the marker'

# A token from another terminal is not this terminal's: start a new one.
run_shell '{}' 1 DOTFILES_HC_SHELL=t3-1-2
grep -Eq '^token t7-[0-9]+-[0-9]+$' "$calls" || fail 'a token from another terminal was kept'

# Outside herdr-core, the hook does nothing.
: >"$calls"
env -u HC_TERMINAL_ID -u DOTFILES_HC_SHELL PATH="$bin:$PATH" CALLS="$calls" \
    fish --no-config -i -c "source '$hook'; emit fish_prompt; if set -q DOTFILES_HC_SHELL; echo token >>'$calls'; end" \
    </dev/null >/dev/null 2>&1
[[ -s $calls ]] && fail 'the hook acted outside herdr-core'

echo 'hc-pi-resume: all checks passed'
