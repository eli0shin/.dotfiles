#!/usr/bin/env python3
"""Exercise the real Herdr client through isolated Unix socket relays, no sshd."""

import fcntl
import json
import os
import pathlib
import pty
import select
import shutil
import socket
import struct
import subprocess
import tempfile
import termios
import threading
import time

REPO = pathlib.Path(__file__).resolve().parent.parent
HERDR, FISH = shutil.which("herdr"), shutil.which("fish")
if not HERDR or not FISH:
    raise SystemExit("SKIP: requires herdr and fish")


def wait_for(check, description, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.05)
    raise AssertionError("timed out: " + description)


def relay_connection(source, target):
    def copy(reader, writer):
        try:
            while data := reader.recv(65536):
                writer.sendall(data)
        except OSError:
            pass
        finally:
            try:
                writer.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    upstream = socket.socket(socket.AF_UNIX)
    upstream.connect(str(target))
    with source, upstream:
        reverse = threading.Thread(target=copy, args=(upstream, source), daemon=True)
        reverse.start()
        copy(source, upstream)
        reverse.join()


def accept_connections(listener, target):
    while True:
        try:
            source, _ = listener.accept()
        except OSError:
            return
        threading.Thread(target=relay_connection, args=(source, target), daemon=True).start()


with tempfile.TemporaryDirectory(prefix="herdr-share-") as directory:
    root = pathlib.Path(directory)
    mac, devbox = root / "mac", root / "devbox"
    mac.mkdir()
    forwarded = devbox / ".cache" / "herdr-work" / "current"
    forwarded.mkdir(parents=True, mode=0o700)
    env = {key: value for key, value in os.environ.items() if not key.startswith("HERDR_")}
    env.update(HOME=str(mac), XDG_CONFIG_HOME=str(mac / ".config"))
    env["HERDR_CONFIG_PATH"] = str(mac / "config.toml")
    pathlib.Path(env["HERDR_CONFIG_PATH"]).write_text(
        'onboarding = false\n[terminal]\ndefault_shell = "/bin/sh"\n'
        '[ui]\nsound.enabled = false\n'
    )
    log = (root / "server.log").open("wb")
    server = subprocess.Popen([HERDR, "server"], env=env, stdout=log, stderr=log)
    phone, master, slave, listeners = None, None, None, []

    def herdr(*args):
        return subprocess.check_output([HERDR, *args], env=env, text=True)

    try:
        api = mac / ".config" / "herdr" / "herdr.sock"
        wait_for(api.exists, "isolated Herdr server")
        created = json.loads(herdr("workspace", "create", "--cwd", str(mac), "--label", "shared-mac"))
        pane = created["result"]["root_pane"]["pane_id"]
        for name in ("herdr.sock", "herdr-client.sock"):
            listener = socket.socket(socket.AF_UNIX)
            listener.bind(str(forwarded / name))
            listener.listen()
            listeners.append(listener)
            threading.Thread(
                target=accept_connections,
                args=(listener, api.parent / name), daemon=True,
            ).start()

        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        phone_env = env | {
            "HOME": str(devbox), "TERM": "xterm-256color",
            "FUNCTION_FILE": str(REPO / "home/.config/fish/functions/work-herdr.fish"),
            "HERDR_SESSION": "devbox", "HERDR_ENV": "1",
        }
        phone = subprocess.Popen(
            [FISH, "--no-config", "-c", 'source "$FUNCTION_FILE"; work-herdr'],
            stdin=slave, stdout=slave, stderr=slave, env=phone_env,
        )
        os.close(slave)
        slave = None
        screen = bytearray()

        def rendered():
            if select.select([master], [], [], 0.1)[0]:
                screen.extend(os.read(master, 65536))
            return b"shared-mac" in screen

        wait_for(rendered, "real Herdr client renders the source workspace")
        time.sleep(0.5)
        marker = "HERDR_SHARE_ROUNDTRIP_OK"
        os.write(master, f'printf "%s\\n" {marker}\r'.encode())
        wait_for(
            lambda: marker in herdr("pane", "read", pane, "--source", "recent").splitlines(),
            "input executes in the original pane",
        )
        os.write(master, b"\x02q")
        phone.wait(timeout=10)
        assert phone.returncode == 0
        assert api.exists(), "detaching stopped the source server"
        print("PASS: real Herdr UI, relayed Unix sockets, input and detach (SSH transport mocked)")
    except BaseException:
        log.flush()
        print((root / "server.log").read_text(errors="replace"))
        if "screen" in locals():
            print(bytes(screen).decode(errors="replace"))
        raise
    finally:
        for proc in (phone, server):
            if proc is not None and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        for listener in listeners:
            listener.close()
        if master is not None:
            os.close(master)
        if slave is not None:
            os.close(slave)
        log.close()
