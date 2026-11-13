#!/usr/bin/env python3
"""Run with python3 tests/herdr-work-bridge.py (no SSH server required)."""

import base64
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "home/.local/bin/herdr-work-bridge"
loader = importlib.machinery.SourceFileLoader("bridge", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
bridge = importlib.util.module_from_spec(spec)
loader.exec_module(bridge)
EXE = str(SCRIPT.resolve())
MARKER = "9E8D5BA0-982A-4208-B654-97BC2B7AEB42"
# Heeler 1.x core locator, captured from a real connection attempt.
HEELER_LOCATOR = '{\n(\n    sleep 8 3>&-\n    printf \'\\n%s\\n\' \'__HEELER_CORE_LOCATOR_TIMEOUT_{timeout}__\' >&3\n    kill -KILL 0\n) </dev/null >/dev/null 3>&2 2>/dev/null &\n__heeler_git_watchdog=$!\n(\n__session=\'default\'\n__nl=\'\n\'\nprintf \'\\n%s begin\\n\' \'{marker}\'\nprintf \'kernel %s\\n\' "$(uname -s 2>/dev/null)"\n__probe() {\n    case "$1" in /*) ;; *) return 1 ;; esac\n    [ -x "$1" ] || return 1\n    __version=$("$1" --version 2>/dev/null </dev/null) || return 1\n    __version=${__version%%"$__nl"*}\n    case "$__version" in \'hc \'[0-9]*|\'herdr-core \'[0-9]*) ;; *) return 1 ;; esac\n    printf \'executable %s\\n\' "$1"\n    printf \'version %s\\n\' "${__version#* }"\n}\n__candidate=$(command -v herdr-core 2>/dev/null) || __candidate=\n__probe "$__candidate" || __probe "${HOME:-}/.local/bin/herdr-core" || :\n__state=${XDG_STATE_HOME:-${HOME:-}/.local/state}/herdr-core/$__session\nif [ -n "${XDG_RUNTIME_DIR:-}" ]; then\n    __run=$XDG_RUNTIME_DIR/herdr-core\nelif [ -d "/run/user/$(id -u)" ]; then\n    __run=/run/user/$(id -u)/herdr-core\nelse\n    __run=$__state\nfi\n__socket=$__run/$__session.sock\nprintf \'default %s\\n\' "$__socket"\n__lock=\n[ -r "$__state/core.lock" ] && __lock=$(cat "$__state/core.lock" 2>/dev/null)\ncase "$__lock" in *"$__nl"*) printf \'lock-unreadable\\n\'; __lock= ;; esac\nif [ -n "$__lock" ]; then\n    printf \'lock %s\\n\' "$__lock"\n    __socket=$__lock\nfi\nif [ -S "$__socket" ]; then printf \'socket-file 1\\n\'; else printf \'socket-file 0\\n\'; fi\n__user=$(id -un 2>/dev/null)\n__shell=$(getent passwd "$__user" 2>/dev/null | cut -d: -f7)\nif [ -z "$__shell" ] && [ -x /usr/bin/dscl ]; then\n    __shell=$(/usr/bin/dscl . -read "/Users/$__user" UserShell 2>/dev/null | sed -n \'s/^UserShell: //p\')\nfi\n[ -z "$__shell" ] || printf \'shell %s\\n\' "$__shell"\nprintf \'%s end\\n\' \'{marker}\'\nexit 0\n) </dev/null\n__heeler_git_status=$?\n{\n    kill -KILL "$__heeler_git_watchdog"\n    wait "$__heeler_git_watchdog"\n} >/dev/null 2>&1\nexit "$__heeler_git_status"\n} </dev/null\n'


def heeler_locator(session="default"):
    return HEELER_LOCATOR.replace("{timeout}", "BF56FF28-8E4F-4D5C-BDBE-1A51BAE4C3C0").replace(
        "{marker}", MARKER
    ).replace("__session='default'", f"__session='{session}'")


class DispatchTests(unittest.TestCase):
    def output(self, command):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            bridge.dispatch(command)
        return output.getvalue()

    def test_framed_stdin_bootstrap(self):
        with patch("sys.stdin", io.StringIO(bridge.FRAME + "command -v herdr\n")):
            self.assertEqual(self.output("/bin/sh -s"), "\n" + bridge.MARKER + "\n" + EXE + "\n")

    def test_discovery_only_advertises_adapter_and_never_executes_script(self):
        script = 'home=${HOME:-}\nuser=${USER:-}\nversion=0.9.5\nemit() {\nmalicious; }\n'
        with patch.object(bridge.subprocess, "run", side_effect=AssertionError("shell executed")):
            self.assertEqual(self.output(script), EXE + "\n")

    def test_capability_probe(self):
        with patch.object(bridge, "status", return_value={"remote_host_bridge": True}) as status:
            output = self.output(f"test -x {EXE} && {EXE} status client --json")
        self.assertEqual(json.loads(output), {"remote_host_bridge": True})
        status.assert_called_once_with("client")

    def test_saved_machine_startup_is_only_a_relay(self):
        with patch.object(bridge, "endpoint", return_value=Path("/socket")), patch.object(bridge, "relay") as relay:
            self.output(f"exec {EXE} remote-client-bridge </dev/null")
        relay.assert_called_once_with(Path("/socket"), idle_timeout=False)

    def test_cached_api_forwarding(self):
        script = (
            f'if capability=$({EXE} --session default remote-api-bridge --check </dev/null 2>/dev/null) '
            '&& [ "$capability" = herdr-api-bridge-v1 ]; then\n'
            f'{bridge.FRAME}exec {EXE} --session default remote-api-bridge\n'
            "else\n    printf '%s\\n' 'herdr-machine-metadata-stale-v1' >&2\n    exit 78\nfi"
        )
        with patch.object(bridge, "api_check"), patch.object(bridge, "herdr") as herdr:
            output = self.output("/bin/sh -c " + shlex.quote(script))
        self.assertIn(bridge.MARKER, output)
        herdr.assert_called_once_with(["remote-api-bridge"])

    def test_core_bootstrap_only_relays_the_forwarded_core_socket(self):
        command = "sh -c " + shlex.quote(bridge.CORE_CONNECT)
        with patch.object(bridge, "endpoint", return_value=Path("/work/hc.sock")) as endpoint, patch.object(
            bridge, "relay"
        ) as relay, patch.object(bridge.subprocess, "run", side_effect=AssertionError("core started")):
            self.output(command)
        endpoint.assert_called_once_with("hc.sock")
        relay.assert_called_once_with(Path("/work/hc.sock"))

    def test_official_ios_connect_only_relays_the_forwarded_core_socket(self):
        for executable in ("hc", "herdr-core"):
            with self.subTest(executable=executable), patch.object(
                bridge, "endpoint", return_value=Path("/work/hc.sock")
            ) as endpoint, patch.object(bridge, "relay") as relay, patch.object(
                bridge.subprocess, "run", side_effect=AssertionError("local core executed")
            ):
                self.output(f"{executable} connect")
                endpoint.assert_called_once_with("hc.sock")
                relay.assert_called_once_with(Path("/work/hc.sock"))

    def test_heeler_home_probe_reports_work_mac_home(self):
        command = 'LC_ALL=C /bin/sh -c \'printf "__HEELER_HOME__=%s\\n" "$HOME"\''
        with patch.object(bridge, "work_mac", return_value={"home": "/Users/me"}), patch.object(
            bridge.subprocess, "run", side_effect=AssertionError("shell executed")
        ):
            self.assertEqual(self.output(command), "__HEELER_HOME__=/Users/me\n")

    def test_heeler_core_locator_is_answered_not_executed(self):
        mac = {"version": "0.1.21", "home": "/Users/me", "kernel": "Darwin"}
        with patch.object(bridge, "work_mac", return_value=mac), patch.object(
            bridge, "endpoint", return_value=Path("/work/tunnel.x/hc.sock")
        ) as endpoint, patch.object(bridge.subprocess, "run", side_effect=AssertionError("shell executed")), patch(
            "sys.stdin", io.StringIO(heeler_locator())
        ):
            output = self.output("/bin/sh -s")
        endpoint.assert_called_once_with("hc.sock")
        self.assertEqual(output, (
            f"\n{MARKER} begin\nkernel Darwin\nexecutable {EXE}\nversion 0.1.21\n"
            f"default {Path.home() / '.cache/herdr-work/current/hc.sock'}\nsocket-file 1\n{MARKER} end\n"
        ))

    def test_heeler_core_locator_for_another_session_is_rejected(self):
        with patch.object(bridge, "work_mac", side_effect=AssertionError("core asked")), self.assertRaises(RuntimeError):
            self.output(heeler_locator(session="other"))

    def test_advertised_executable_serves_core_connect_and_version(self):
        with patch.object(bridge, "endpoint", return_value=Path("/work/hc.sock")), patch.object(bridge, "relay") as relay:
            self.output(f"{EXE} connect")
        relay.assert_called_once_with(Path("/work/hc.sock"))
        with patch.object(bridge, "core_version", return_value="0.1.21"):
            self.assertEqual(self.output(f"{shlex.quote(EXE)} --version"), "hc 0.1.21\n")

    def test_authentication_probe_has_no_side_effects(self):
        self.assertEqual(self.output("exit"), "")

    def test_other_executables_sessions_and_server_start_are_rejected(self):
        for command in (
            "/bin/sh -c 'touch /tmp/not-a-shell'", "/usr/bin/herdr status server --json",
            f"{EXE} --session work remote-client-bridge", f"{EXE} server",
            f"{EXE} server stop", f"{EXE} update", "",
            "hc server start", "hc connect; uname -a", "hc connect --session other",
            "hc --version; uname -a", "hc --version extra", "herdr-core update",
            "sh -c " + shlex.quote(bridge.CORE_CONNECT.replace('exec "$p" connect', 'HC_SESSION=other exec "$p" connect')),
            "sh -c " + shlex.quote(bridge.CORE_CONNECT + "; touch /tmp/not-a-shell"),
        ):
            with self.subTest(command=command), self.assertRaises(RuntimeError):
                self.output(command)

    def test_client_status_does_not_require_live_tunnel(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "config.json").write_text('{"herdr":"/fake/herdr"}')
            result = subprocess.CompletedProcess([], 0, '{"version":"0.9.5","binary":"native"}')
            with patch.object(bridge, "__file__", str(path / "herdr")), patch.object(
                bridge.subprocess, "run", return_value=result
            ) as run:
                data = bridge.status("client")
            self.assertEqual(data["binary"], str((path / "herdr").resolve()))
            self.assertTrue(data["remote_host_bridge"])
            self.assertNotIn("HERDR_SOCKET_PATH", run.call_args.kwargs["env"])

    def test_status_is_pinned_to_work_socket_and_clears_inherited_session(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "config.json").write_text('{"herdr":"/fake/herdr"}')
            result = subprocess.CompletedProcess([], 0, '{"running":true}')
            with patch.object(bridge, "__file__", str(path / "herdr")), patch.object(
                bridge, "endpoint", return_value=Path("/work/herdr.sock")
            ), patch.dict(os.environ, {"HERDR_SESSION": "devbox", "HERDR_SOCKET_PATH": "/devbox"}), patch.object(
                bridge.subprocess, "run", return_value=result
            ) as run:
                self.assertTrue(bridge.status("server")["running"])
            env = run.call_args.kwargs["env"]
            self.assertEqual(env["HERDR_SOCKET_PATH"], "/work/herdr.sock")
            self.assertNotIn("HERDR_SESSION", env)


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="herdr-work-", dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.tunnel = self.home / ".cache/herdr-work/tunnel.test"
        self.tunnel.mkdir(parents=True)
        (self.tunnel.parent / "current").symlink_to(self.tunnel, target_is_directory=True)
        self.env = dict(os.environ, HOME=str(self.home))

    def test_real_stdio_binary_roundtrip_backpressure_and_half_close(self):
        listener = socket.socket(socket.AF_UNIX)
        self.addCleanup(listener.close)
        listener.bind(str(self.tunnel / "herdr-client.sock"))
        listener.listen()
        payload = bytes(range(256)) * 16384  # Larger than both relay buffers.
        errors = []

        def peer():
            try:
                stream, _ = listener.accept()
                with stream:
                    stream.settimeout(10)
                    received = bytearray()
                    while data := stream.recv(65536):
                        received.extend(data)
                        stream.sendall(data)
                    self.assertEqual(received, payload)
                    stream.sendall(b"after-half-close")
            except BaseException as error:
                errors.append(error)

        thread = threading.Thread(target=peer, daemon=True)
        thread.start()
        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": f"exec {EXE} remote-client-bridge"},
            input=payload, capture_output=True, timeout=20,
        )
        thread.join(timeout=12)
        self.assertFalse(thread.is_alive())
        self.assertFalse(errors, errors)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, payload + b"after-half-close")

    def test_core_roundtrip_and_missing_tunnel(self):
        listener = socket.socket(socket.AF_UNIX)
        self.addCleanup(listener.close)
        path = self.tunnel / "hc.sock"
        listener.bind(str(path))
        listener.listen()

        def peer():
            stream, _ = listener.accept()
            with stream:
                while data := stream.recv(65536):
                    stream.sendall(data)

        thread = threading.Thread(target=peer, daemon=True)
        thread.start()
        command = "sh -c " + shlex.quote(bridge.CORE_CONNECT)
        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": command},
            input=b"core-handshake\x00\xff", capture_output=True, timeout=5,
        )
        thread.join(timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b"core-handshake\x00\xff")
        listener.close()
        path.unlink()
        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": command},
            input=b"", capture_output=True, timeout=5,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / ".local/state/herdr-core").exists())

    def test_official_ios_connect_roundtrip_and_missing_tunnel(self):
        listener = socket.socket(socket.AF_UNIX)
        self.addCleanup(listener.close)
        path = self.tunnel / "hc.sock"
        listener.bind(str(path))
        listener.listen()
        listener.settimeout(1)

        def peer():
            try:
                stream, _ = listener.accept()
            except OSError:
                return
            with stream:
                stream.settimeout(5)
                while data := stream.recv(65536):
                    stream.sendall(data)

        thread = threading.Thread(target=peer, daemon=True)
        thread.start()
        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": "hc connect"},
            input=b"ios-core-handshake\x00\xff", capture_output=True, timeout=5,
        )
        thread.join(timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b"ios-core-handshake\x00\xff")
        listener.close()
        path.unlink()
        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": "hc connect"},
            input=b"", capture_output=True, timeout=5,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / ".local/state/herdr-core").exists())

    def test_official_ios_version_comes_from_work_core_not_devbox(self):
        for reply, expected in (
            ({"jsonrpc": "2.0", "id": 0, "result": {"version": "0.1.42"}}, b"hc 0.1.42\n"),
            ({"jsonrpc": "2.0", "id": 0, "error": {"message": "unavailable"}}, None),
        ):
            with self.subTest(reply=reply):
                path = self.tunnel / "hc.sock"
                with socket.socket(socket.AF_UNIX) as listener:
                    listener.bind(str(path))
                    listener.listen()
                    listener.settimeout(1)
                    requests = []

                    def peer():
                        try:
                            stream, _ = listener.accept()
                        except OSError:
                            return
                        stream.settimeout(5)
                        with stream, stream.makefile("rb") as reader:
                            requests.append(json.loads(reader.readline()))
                            stream.sendall(json.dumps(reply).encode() + b"\n")

                    thread = threading.Thread(target=peer, daemon=True)
                    thread.start()
                    result = subprocess.run(
                        [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": "hc --version"},
                        input=b"", capture_output=True, timeout=5,
                    )
                    thread.join(timeout=1)
                path.unlink()
                if expected is None:
                    self.assertNotEqual(result.returncode, 0)
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout, expected)
                    self.assertEqual(requests[0]["method"], "hello")
                    self.assertEqual(requests[0]["params"]["generation"], 1)

        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": "hc --version"},
            input=b"", capture_output=True, timeout=5,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / ".local/state/herdr-core").exists())

    def test_work_mac_facts_come_from_a_fixed_program_on_the_work_core(self):
        path = self.tunnel / "hc.sock"
        requests = []
        replies = [
            {"jsonrpc": "2.0", "id": 0, "result": {"version": "0.1.21"}},
            {"jsonrpc": "2.0", "id": 1, "result": {"code": 0, "stdout": base64.b64encode(b"/Users/me\nDarwin\n").decode()}},
        ]
        with socket.socket(socket.AF_UNIX) as listener:
            listener.bind(str(path))
            listener.listen()

            def peer():
                stream, _ = listener.accept()
                stream.settimeout(5)
                with stream, stream.makefile("rb") as reader:
                    for reply in replies:
                        requests.append(json.loads(reader.readline()))
                        stream.sendall(json.dumps(reply).encode() + b"\n")

            thread = threading.Thread(target=peer, daemon=True)
            thread.start()
            result = subprocess.run(
                [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": "/bin/sh -s"},
                input=heeler_locator().encode(), capture_output=True, timeout=5,
            )
            thread.join(timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b"\nkernel Darwin\nexecutable ", result.stdout)
        self.assertIn(b"\nversion 0.1.21\n", result.stdout)
        self.assertEqual([request["method"] for request in requests], ["hello", "machine.exec"])
        self.assertEqual(requests[1]["params"]["argv"][:2], ["/bin/sh", "-c"])
        self.assertFalse((self.home / ".local/state/herdr-core").exists())

        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": "/bin/sh -s"},
            input=heeler_locator().encode(), capture_output=True, timeout=5,
        )
        self.assertNotEqual(result.returncode, 0)  # No live core: fail rather than describe Devbox.

    def test_stale_socket_is_not_unlinked_or_replaced(self):
        path = self.tunnel / "herdr-client.sock"
        with socket.socket(socket.AF_UNIX) as stream:
            stream.bind(str(path))
        inode = path.stat().st_ino
        result = subprocess.run(
            [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": f"{EXE} remote-client-bridge"},
            input=b"", capture_output=True, timeout=5,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(path.stat().st_ino, inode)
        self.assertFalse((self.home / ".config/herdr").exists())

    def test_dead_tunnel_fails_without_creating_sockets_or_servers(self):
        for live_current in (True, False):
            if not live_current:
                (self.tunnel.parent / "current").unlink()
            result = subprocess.run(
                [str(SCRIPT)], env=self.env | {"SSH_ORIGINAL_COMMAND": f"{EXE} remote-client-bridge"},
                input=b"", capture_output=True, timeout=5,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(self.tunnel.iterdir()), [])
            self.assertFalse((self.home / ".config/herdr").exists())


class ShareTests(unittest.TestCase):
    def forwards(self, core=False, explicit_missing=False):
        with tempfile.TemporaryDirectory(prefix="share-core-", dir="/tmp") as directory:
            root = Path(directory)
            tools = root / "bin"
            tools.mkdir()
            api = root / "herdr.sock"
            sockets = [api, root / "herdr-client.sock"]
            core_socket = root / ".local/state/herdr-core/default/default.sock"
            if core:
                core_socket.parent.mkdir(parents=True)
                sockets.append(core_socket)
            listeners = []
            try:
                for path in sockets:
                    listener = socket.socket(socket.AF_UNIX)
                    listeners.append(listener)
                    listener.bind(str(path))
                (tools / "herdr").write_text(
                    '#!/usr/bin/env python3\nimport json,os\n'
                    'print(json.dumps({"running":True,"socket":os.environ["TEST_API"]}))\n'
                )
                (tools / "ssh").write_text(
                    '#!/usr/bin/env python3\nimport json,os,pathlib,sys\n'
                    'if "-R" in sys.argv:\n'
                    ' pathlib.Path(os.environ["TEST_ARGS"]).write_text(json.dumps(sys.argv[1:]))\n'
                    ' sys.exit(42)\n'
                    'print(os.environ["HOME"]+"/.cache/herdr-work/tunnel.test")\n'
                )
                for tool in tools.iterdir():
                    tool.chmod(0o700)
                env = {key: value for key, value in os.environ.items() if not key.startswith(("HERDR_", "HC_", "XDG_"))}
                env.update(HOME=str(root), PATH=str(tools) + os.pathsep + os.environ["PATH"],
                           TEST_API=str(api), TEST_ARGS=str(root / "args.json"))
                if explicit_missing:
                    env["HERDR_SHARE_HC_SOCKET"] = str(core_socket)
                result = subprocess.run(
                    [str(SCRIPT.with_name("herdr-share"))], env=env, capture_output=True, timeout=5,
                )
                self.assertNotEqual(result.returncode, 0)  # Fake ssh deliberately ends the loop.
                if explicit_missing:
                    self.assertIn(b"core socket not found", result.stderr)
                    self.assertFalse((root / "args.json").exists())
                    return []
                args = json.loads((root / "args.json").read_text())
                return [args[index + 1] for index, arg in enumerate(args) if arg == "-R"]
            finally:
                for listener in listeners:
                    listener.close()

    def test_core_socket_is_optional_and_does_not_change_tui_forwards(self):
        self.assertEqual(len(self.forwards()), 2)
        forwards = self.forwards(core=True)
        self.assertEqual(len(forwards), 3)
        self.assertTrue(any("/hc.sock:" in value for value in forwards))

    def test_explicit_missing_core_endpoint_is_an_error(self):
        self.forwards(explicit_missing=True)


if __name__ == "__main__":
    unittest.main()
