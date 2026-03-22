# Plan mode

Read-only exploration mode for Pi.

## Features

- `/plan` toggles a read-only planning mode
- `Ctrl+Alt+P` toggles plan mode quickly
- `/todos` shows the current extracted plan
- plan steps are extracted from a `Plan:` section
- `[DONE:n]` markers track execution progress after you switch out of plan mode
- read-only web research tools stay available when installed

## Behavior

When plan mode is on, Pi only gets read-only tools:

- `read`
- `bash` with a read-only allowlist
- `grep`
- `find`
- `ls`
- optional web research tools such as `web_search`, `fetch_content`, `web_search_exa`, and `get_code_context_exa` when they are installed

When you choose `Execute the plan`, Pi restores your previous tool set and tracks completion with `[DONE:n]` markers.
