# Acting on the triage

Take the session's `manager`, IDs, cwd, and session file from a fresh `scripts/agent-status --signals` run. Each action targets the session Eli named and never the current session. Leave Eli's focus where he put it: legacy herdr tabs use `--no-focus`, and the Herdr app always shows a new tab, so refocus your own terminal right after with `herdr-app do pane.focus --terminal "$HC_TERMINAL_ID"`.

## Legacy herdr (`manager: herdr`)

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

## Herdr app (`manager: herdr-app`)

The app arranges spaces and tabs; herdr-core (`hc`) talks to the terminals.

- **Close:** `herdr-app do pane.close --pane <pane_id>`.
- **Focus:** `herdr-app do agent.focus --terminal <terminal>`.
- **Reply:** `hc send <terminal> "<reply>"`.
- **Check on worker:** as above, prompt only the idle orchestrator:
  ```bash
  hc send --if idle <orchestrator_terminal> "Worker <branch> (<repo>#<pr>) stopped <N> minutes ago and PR Watch did not tell you. Its last message: <one-line summary>. Check on it."
  ```
- **Resume** a closed session:
  1. Run `herdr-app do tab.new --space <space_id> --name "<old tab label>" --folder <cwd> --argv '["pi","--session","<session-uuid>"]'`, then refocus your own terminal. The new terminal is `terminal` in the reply.
  2. The resume is complete when `hc get <terminal>` has the label `dotfiles.pi_session` set to that same session file.
- **Close when done:** run `hc wait <terminal> --timeout 600`, then confirm the result with `hc read <terminal> --lines 100`, then close the pane. If the read shows a question or a failure, report it to Eli and leave the pane open.
