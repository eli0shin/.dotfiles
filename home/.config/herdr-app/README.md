# Herdr app configuration

Migrated from `../herdr/config.toml` for Herdr app 0.1.13. The legacy config
remains intact.

`~/.config/herdr-app` is a directory symlink to this folder, managed by Stow.
Keeping the directory symlink (rather than individual file symlinks) lets the
app's atomic settings saves update the dotfiles too. `.gitignore` allows only
personal configuration: generated guides/types, shipped layouts/mods/themes,
sockets, terminal/window state, layout click state, telemetry and caches stay
untracked. Don't commit those files.

## Setup

Run `dot stow` before first launching Herdr on a new machine. After launching:

```sh
herdr-app do layout.switch --name eli
herdr-app status
```

The selected layout is runtime state, not shared between machines. `eli` is a
personal clone of the shipped `main` layout; shipped files are never edited.
It uses a hidden sidebar (toggle with Ctrl+G, B), top tabs even for a single
tab, and square, gapless panes without individual pane headers. Borders appear
only when split. The old 48/24/72-character sidebar sizes are approximated as
400/200/600 logical pixels. Agent sorting defaults to priority in the shipped
Agents mod. The new app does not offer the old exact inner-border-only or
tab-bar hostname options; its stock status bar identifies the machine.

`settings.json` disables sounds and terminal scrollbars and fixes appearance
to dark. The Arctic theme retains the legacy semantic UI colors and uses the
same terminal background, foreground and ANSI palette as Ghostty/Neovim.
Kitty graphics are supported by the app without an experimental setting.

## Keys

Native macOS shortcuts are retained. Prefix shortcuts are native GPUI
sequences: `ctrl-g c` means press Ctrl+G, release, then C (not Ctrl+G+C).

| After Ctrl+G | Action |
| --- | --- |
| C / S | Settings / spaces picker (`space-picker`) |
| K / J | Previous / next agent |
| Ctrl+S / X | New / close space (legacy workspace) |
| D | Close the window; core terminals keep running (legacy detach) |
| T / R | New / rename tab |
| P / N / 1–9 | Previous / next / numbered tab |
| Shift+1–9 | Focus agent N, in the Agents list order (`eli` layout) |
| Shift+Q | Close tab |
| V / H | Split right / down |
| Q | Close pane |
| B | Toggle sidebar |
| Ctrl+L | Send Ctrl+L to the terminal (clear shell screen) |

### Neovim-aware Ctrl+H/J/K/L

In the `eli` layout, `navigator-status` (a personal clone of the status bar)
checks the focused terminal's foreground process via `hc`. For Neovim/Vim
and fzf it forwards the original key with `hc keys`; elsewhere it moves to
the adjacent Herdr pane. Neovim's local `herdr-app-navigator` module moves
between editor splits in normal mode, then labels its core terminal with a
unique `dotfiles.navigator` request only at an edge. The app consumes the
request once, and only while its source terminal is still focused. This
also works with remote cores when these Neovim dotfiles are installed there;
no remote `herdr-app` binary is required. Insert-mode keys keep their normal
Neovim behavior. The mod uses core commands/labels, with no network access
or external file reads.

The bridge loads automatically for new Neovim sessions inside herdr-core.
For an already-open Neovim, run `:lua require('herdr-app-navigator').setup()`
to replace its existing normal-mode navigation mappings. New sessions disable
conflicting tmux.nvim bindings automatically. Legacy Herdr keeps its existing plugin, nested
tmux keeps its own navigation, and ordinary terminals remain unchanged.
Other app layouts retain native pane navigation; use `eli` for the bridge.

Regression checks:

```sh
node tests/herdr-app-navigation.mjs
nvim --headless -u NONE -l tests/herdr-app-navigation.lua
herdr-app check ~/.config/herdr-app/mods/navigator-status
```

The old Lumen Alt+J/K shell aliases also depend on the legacy pane API and
are not installed here; use Lumen's own controls instead.

### Spaces picker and numbered agents

`space-picker` restores the legacy workspace picker on Ctrl+G, S: it lists
spaces only, numbered in sidebar order. J/K or arrows move, Enter switches,
1–9 jumps straight to that space, Esc or Q closes. The shipped tab/agent
picker stays on Cmd+P. Ctrl+1–9 also switch spaces directly.

`eli-agents` is a personal clone of the shipped Agents list that ends each
row with its number (1–9), so there's no counting. Ctrl+G, Shift+1–9 (bound
as both `shift-1` and `!` spellings) focuses that row: the app has no
"focus agent N" command, so `eli-agents` publishes its order in shared state
and `navigator-status` focuses the Nth agent from it. When that order is
stale (the sidebar hasn't been shown since launch, so it isn't running),
`agent-order.js` mirrors the list's sort instead: pinned first, then by
priority (a parent takes its most urgent sub-agent's rank) or by space when
grouped. That fallback can differ from the list for an agent you're viewing
that just finished, or for ties within a section; open the sidebar once
(Ctrl+G, B) to use the exact order.

### Not migrated: no built-in equivalent

- Ctrl+G, E: edit scrollback; Ctrl+G, [: copy mode. Cmd+F searches scrollback;
  select text and Cmd+C to copy.
- Alt+Shift+H/J/K/L: resize panes (drag split dividers instead).
- Annotation/document-review plugin keys: Ctrl+G followed by A, Shift+A,
  Ctrl+A, M, O or Shift+O. They need a separate mod/CLI integration.
- The old pane navigation-mode H/J/K/L bindings. The tab/agent picker
  (Cmd+P) uses arrow keys and typing filters the list.

These missing actions are deliberately not bound to non-existent commands.
