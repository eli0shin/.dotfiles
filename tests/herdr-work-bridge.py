#!/usr/bin/env python3
"""Run with python3 tests/herdr-work-bridge.py (no SSH server required)."""

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

    def test_authentication_probe_has_no_side_effects(self):
        self.assertEqual(self.output("exit"), "")

    def test_other_executables_sessions_and_server_start_are_rejected(self):
        for command in (
            "/bin/sh -c 'touch /tmp/not-a-shell'", "/usr/bin/herdr status server --json",
            f"{EXE} --session work remote-client-bridge", f"{EXE} server",
            f"{EXE} server stop", f"{EXE} update", "",
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
