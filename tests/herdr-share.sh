#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
script="$repo_root/home/.local/bin/herdr-share"
function_file="$repo_root/home/.config/fish/functions/work-herdr.fish"
test_root=$(mktemp -d)
socket_pid=
cleanup() {
    if [[ -n $socket_pid ]]; then
        kill "$socket_pid" 2>/dev/null || true
        wait "$socket_pid" 2>/dev/null || true
    fi
    rm -rf "$test_root"
}
trap cleanup EXIT
mkdir -p "$test_root/bin" "$test_root/mac" "$test_root/relay"
export TEST_ROOT="$test_root" FUNCTION_FILE="$function_file"
export PATH="$test_root/bin:$PATH"
export HOME="$test_root/relay"
export TEST_SOCKET="$test_root/mac/herdr.sock"

cat >"$test_root/bin/herdr" <<'MOCK'
#!/usr/bin/env bash
set -eu
if [[ $* == *'status server --json' ]]; then
    printf '%s\n' "$*" >"$TEST_ROOT/status-args"
    jq -n --arg socket "$TEST_SOCKET" --argjson running "${TEST_RUNNING:-true}" \
        '{running: $running, socket: $socket}'
elif [[ $* == client ]]; then
    [[ ${HERDR_SOCKET_PATH:-} == "$HOME/.cache/herdr-work/current/herdr.sock" ]]
    [[ ${HERDR_REMOTE_KEYBINDINGS:-} == server ]]
    [[ ! ${HERDR_SESSION+x} && ! ${HERDR_ENV+x} && ! ${HERDR_CLIENT_SOCKET_PATH+x} ]]
    printf 'client\n' >>"$TEST_ROOT/attached"
else
    echo 'unexpected Herdr invocation' >&2
    exit 1
fi
MOCK
cat >"$test_root/bin/ssh" <<'MOCK'
#!/usr/bin/env bash
set -eu
python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >>"$TEST_ROOT/ssh-args"
if [[ " $* " == *' ClearAllForwardings=yes '* ]]; then
    exec sh -s
fi
printf '%s\n' "$*" >"$TEST_ROOT/tunnel-args"
# Capture the remote script; execute it below with real test sockets.
cat >"$TEST_ROOT/remote-script"
MOCK
cat >"$test_root/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
set -eu
if [[ ${TEST_BROKEN_PIPE:-} == 1 ]]; then
    exit 0
fi
base="$HOME/.cache/herdr-work"
[[ $(readlink "$base/current") == "$REMOTE_DIR" ]]
[[ $(stat -c %a "$base") == 700 && $(stat -c %a "$REMOTE_DIR") == 700 ]]
HERDR_SESSION=devbox HERDR_ENV=1 HERDR_CLIENT_SOCKET_PATH=/wrong \
    fish --no-config -c 'source "$FUNCTION_FILE"; work-herdr'
exit 1
MOCK
chmod +x "$test_root/bin/"*

# Only isolated fixture sockets; no existing Herdr sessions or SSH hosts used.
python3 - "$test_root" <<'PY' &
import os, signal, socket, sys
root = sys.argv[1]
sockets = []
os.makedirs(root + '/mac/.config/herdr')
for name in ('herdr.sock', 'herdr-client.sock', '.config/herdr/api',
             '.config/herdr/api-client.sock', '.config/herdr/.api',
             '.config/herdr/.api-client.sock'):
    sock = socket.socket(socket.AF_UNIX)
    sock.bind(root + '/mac/' + name)
    sockets.append(sock)
open(root + '/sockets-ready', 'w').close()
signal.pause()
PY
socket_pid=$!
for ((i=0; i<100; i++)); do
    [[ -f $test_root/sockets-ready ]] && break
    # Do not use our remote heartbeat mock here.
    /bin/sleep 0.02
done
[[ -f $test_root/sockets-ready ]]

bash "$script" >"$test_root/output"
python3 - "$test_root" <<'PY'
import json, os, sys
root = sys.argv[1]
calls = [json.loads(line) for line in open(root + '/ssh-args')]
assert len(calls) == 2, calls
prep, tunnel = calls
assert 'ClearAllForwardings=yes' in prep
assert 'ClearAllForwardings=yes' not in tunnel
assert 'ClearAllForwardings=no' in tunnel
assert 'ExitOnForwardFailure=yes' in tunnel
assert 'ControlPath=none' in tunnel
assert 'elioshinsky@devbox.home.arpa' in tunnel
forwards = [tunnel[i+1] for i, arg in enumerate(tunnel) if arg == '-R']
assert len(forwards) == 2, forwards
assert forwards[0].endswith('/herdr.sock:' + root + '/mac/herdr.sock')
assert forwards[1].endswith('/herdr-client.sock:' + root + '/mac/herdr-client.sock')
assert not any(':22' in arg for arg in forwards)
remote_dir = forwards[0].split(':')[0].rsplit('/', 1)[0]
assert os.stat(remote_dir).st_mode & 0o777 == 0o700
open(root + '/remote-dir', 'w').write(remote_dir)
PY
remote_dir=$(<"$test_root/remote-dir")
export REMOTE_DIR="$remote_dir"

# The receiver must fail closed before any tunnel exists.
# shellcheck disable=SC2016 # Fish expands its exported environment.
if fish --no-config -c 'source "$FUNCTION_FILE"; work-herdr' 2>"$test_root/error"; then
    echo 'FAIL: attach succeeded with no tunnel' >&2
    exit 1
fi
[[ ! -e $test_root/attached ]]

# Simulate forwarded sockets and exercise activation, attachment and cleanup.
python3 - "$remote_dir" <<'PY'
import socket, sys
for name in ('herdr.sock', 'herdr-client.sock'):
    sock = socket.socket(socket.AF_UNIX)
    sock.bind(sys.argv[1] + '/' + name)
    sock.close()
PY
sh "$test_root/remote-script" "$remote_dir" >"$test_root/remote-output"
grep -Fxq client "$test_root/attached"
[[ ! -e $remote_dir && ! -L $HOME/.cache/herdr-work/current ]]

# Named sessions and custom destinations are passed as separate arguments.
bash "$script" custom-host work >"$test_root/output"
grep -Fxq -- '--session work status server --json' "$test_root/status-args"
grep -q 'custom-host' "$test_root/tunnel-args"

# A broken SSH output pipe must run cleanup, including under dash /bin/sh.
pipe_dir="$HOME/.cache/herdr-work/pipe-test"
mkdir "$pipe_dir"
TEST_BROKEN_PIPE=1 python3 - "$test_root/remote-script" "$pipe_dir" <<'PY'
import os, subprocess, sys
proc = subprocess.Popen(['sh', sys.argv[1], sys.argv[2]], stdout=subprocess.PIPE)
proc.stdout.close()
assert proc.wait(timeout=5) == 0
assert not os.path.exists(sys.argv[2]), 'SIGPIPE skipped cleanup'
assert not os.path.islink(os.environ['HOME'] + '/.cache/herdr-work/current')
PY

# File-stem derivation must not strip a dotted parent or leading-dot basename.
for name in api .api; do
    TEST_SOCKET="$test_root/mac/.config/herdr/$name" bash "$script" >"$test_root/output"
    grep -Fq "$test_root/mac/.config/herdr/$name-client.sock" "$test_root/tunnel-args"
done

# Never launch or forward a nonexistent local session.
: >"$test_root/ssh-args"
if TEST_RUNNING=false bash "$script" >"$test_root/output" 2>"$test_root/error"; then
    echo 'FAIL: shared a stopped session' >&2
    exit 1
fi
[[ ! -s $test_root/ssh-args ]]
if TEST_SOCKET="$test_root/mac/missing.sock" bash "$script" >"$test_root/output" 2>"$test_root/error"; then
    echo 'FAIL: shared a missing socket' >&2
    exit 1
fi
[[ ! -s $test_root/ssh-args ]]
if bash "$script" -o >"$test_root/output" 2>"$test_root/error"; then
    echo 'FAIL: accepted an option as the SSH destination' >&2
    exit 1
fi
# shellcheck disable=SC2016 # Fish expands its exported environment.
if fish --no-config -c 'source "$FUNCTION_FILE"; work-herdr unexpected' 2>"$test_root/error"; then
    echo 'FAIL: attach accepted unexpected arguments' >&2
    exit 1
fi

printf 'PASS: Herdr reverse socket sharing and Fish attachment\n'
