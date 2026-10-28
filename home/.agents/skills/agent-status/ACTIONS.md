# Acting on the triage

Take the pane, workspace, cwd, and session file from a fresh `scripts/agent-status --signals` run. Each action targets the session Eli named and never the current session. Every tab you create uses `--no-focus`, so Eli's focus stays where he put it.

- **Close:** `herdr pane close <pane_id>`.
- **Focus:** `herdr agent focus <pane_id>`.
- **Reply** (Eli's answer to a session's question or offer): `herdr agent prompt <pane_id> "<reply>" --wait --until working`.
- **Check on worker:** prompt the **orchestrator**, never the worker. The orchestrator messages its workers itself through `message-worker`. When the orchestrator is idle, run:
  ```bash
  herdr agent prompt <orchestrator_pane_id> "Worker <branch> (<repo>#<pr>) stopped <N> minutes ago and PR Watch did not tell you. Its last message: <one-line summary>. Check on it."
  ```
- **Resume** a closed session:
  1. Run `herdr tab create --workspace <workspace_id> --cwd <cwd> --label <old tab label> --no-focus`. The new pane ID is `result.root_pane.pane_id`.
  2. Run `herdr pane run <pane_id> "pi --session <session-uuid>"`. The UUID is the part of the session file name after `_`. The pi command must be one quoted argument: unquoted, herdr reads `--session` as its own flag, and a `--` separator reaches the shell literally.
  3. The resume is complete when `herdr agent get <pane_id>` reports that same session file.
- **Close when done:** run `herdr agent wait <pane_id> --until idle --until done --until blocked --timeout 600000`, then confirm the result with `herdr agent read <pane_id>`, then close the pane. If the read shows a question or a failure, report it to Eli and leave the pane open.
