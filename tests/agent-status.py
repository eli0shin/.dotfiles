#!/usr/bin/env python3
"""Run with python3 tests/agent-status.py (fake herdr, herdr-app and hc)."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "home/.agents/skills/agent-status/scripts/agent-status"

HERDR = """#!/bin/sh
printf 'herdr %s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  "status server") printf '{"running":%s}\\n' "$HERDR_RUNNING" ;;
  "workspace list") echo '{"result":{"workspaces":[{"workspace_id":"w1","label":"tui-space"}]}}' ;;
  "tab list") echo '{"result":{"tabs":[{"tab_id":"w1:t1","label":"build","number":1}]}}' ;;
  "agent list") echo '{"result":{"agents":[{"pane_id":"w1:p1","workspace_id":"w1","tab_id":"w1:t1","agent":"claude","agent_status":"idle","cwd":"/a"}]}}' ;;
esac
"""

HERDR_APP = """#!/bin/sh
printf 'herdr-app %s\\n' "$*" >> "$CALLS"
[ -n "$APP_WINDOW" ] || exit 1
cat <<'EOF'
{"spaces":[
 {"id":"sp1","name":"repo@fix","machine":null,"tabs":[
  {"id":"tb1","name":"pi","terminals":[
   {"terminal":"t3","pane":"pa3","status":"done","app":"pi"},
   {"terminal":"t4","pane":"pa4","status":null,"app":null}]}]},
 {"id":"vps/sp2","name":"remote","machine":"vps","tabs":[
  {"id":"vps/tb2","name":"1","terminals":[{"terminal":"vps/t1","pane":"vps/pa1","status":"idle","app":"pi"}]}]}]}
EOF
"""

HC = """#!/bin/sh
printf 'hc %s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  "ls --json") echo '{"terminals":[{"address":"t3","status":"done","where":"repo@fix / pi"},{"address":"t4","where":"repo@fix / 2"},{"address":"t6","status":"done","where":"repo@fix / 3"},{"address":"vps/t1","status":"idle"}]}' ;;
  "get t3") printf '{"cwd":"/w","foreground":{"cwd":"/w/sub"},"status":{"app":"pi"},"turn":2,"labels":{"herdr.seen":"1","dotfiles.pi_session":"%s"}}\\n' "$SESSION" ;;
  "get t6") echo '{"cwd":"/w","status":{"app":"claude"},"turn":4,"labels":{"herdr.seen":"4"}}' ;;
  *) exit 1 ;;
esac
"""


class AgentStatusTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        root = Path(self.root.name)
        (root / "bin").mkdir()
        for name, body in {"herdr": HERDR, "herdr-app": HERDR_APP, "hc": HC}.items():
            path = root / "bin" / name
            path.write_text(body)
            path.chmod(0o755)
        self.calls = root / "calls"
        self.session = root / "session.jsonl"
        self.session.write_text(json.dumps({
            "type": "message", "id": "m1", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "content": "Done."},
        }) + "\n")
        self.env = {
            "PATH": f"{root / 'bin'}:/usr/bin:/bin", "HOME": str(root), "CALLS": str(self.calls),
            "SESSION": str(self.session), "HERDR_RUNNING": "true", "APP_WINDOW": "1",
        }

    def tearDown(self):
        self.root.cleanup()

    def signals(self, **env):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--signals"], capture_output=True, text=True, env={**self.env, **env},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_reports_legacy_herdr_then_local_herdr_app_agents(self):
        tui, app = self.signals()
        self.assertEqual(
            {k: tui[k] for k in ("manager", "workspace", "tab", "pane_id", "workspace_id", "agent")},
            {"manager": "herdr", "workspace": "tui-space", "tab": "build", "pane_id": "w1:p1",
             "workspace_id": "w1", "agent": "claude"},
        )
        self.assertEqual(
            {k: app[k] for k in ("manager", "workspace", "tab", "terminal", "pane_id", "space_id", "tab_id",
                                  "cwd", "agent", "herdr_status", "session_file")},
            {"manager": "herdr-app", "workspace": "repo@fix", "tab": "pi", "terminal": "t3", "pane_id": "pa3",
             "space_id": "sp1", "tab_id": "tb1", "cwd": "/w/sub", "agent": "pi", "herdr_status": "done",
             "session_file": str(self.session)},
        )
        self.assertEqual(app["last_assistant"]["text"], "Done.")
        self.assertNotIn("hc ls", self.calls.read_text())

    def test_never_asks_hc_without_evidence_of_a_running_core(self):
        # hc starts a core when none is running.
        self.assertEqual(self.signals(HERDR_RUNNING="false", APP_WINDOW=""), [])
        self.assertNotIn("hc ", self.calls.read_text())
        self.assertNotIn("herdr agent", self.calls.read_text())

    def test_inside_herdr_core_without_a_window_uses_terminal_labels(self):
        unseen, seen = self.signals(HERDR_RUNNING="false", APP_WINDOW="", HC_TERMINAL_ID="t9")
        self.assertEqual(
            [(a["workspace"], a["tab"], a["terminal"], a["agent"], a["herdr_status"]) for a in (unseen, seen)],
            [("repo@fix", "pi", "t3", "pi", "done"), ("repo@fix", "3", "t6", "claude", "idle")],
        )
        self.assertEqual(unseen["session_file"], str(self.session))

    def test_this_session_knows_its_own_session_file(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], capture_output=True, text=True,
            env={**self.env, "HERDR_RUNNING": "false", "SESSION": "", "HC_TERMINAL_ID": "t3",
                 "PI_SESSION_FILE": str(self.session)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("| app | repo@fix | pi (this session) | — | — |", result.stdout)


if __name__ == "__main__":
    unittest.main()
