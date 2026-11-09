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

Run `dot stow` before first launching Herdr on a new machine. It automatically
selects the `eli` layout and removes the top-right Files/Changes buttons. No
manual layout switch or welcome setup is needed. On an existing installation,
`dot stow` applies them to the running app too; no restart is needed.

`shared.defaults.json` tracks these preferences and marks the welcome setup as
finished unless it was already finished or skipped. `scripts/configure-herdr-app.sh` applies those keys to the ignored
`shared.json` during stow, preserving all other machine-local mod state. Managed
keys are reapplied on each stow; arrays are replaced, not concatenated. A running
app holds `shared.json` in memory (read once at launch, rewritten on every
shared change), so stow never edits the file under it. It sends the changes
instead: `layout.switch` for the layout, and
`navigator-status.set-shared:<json>` for other keys, which `navigator-status`
passes to `setShared`. The app then persists them itself. If the app doesn't
respond, stow warns and continues; it never blocks the rest of stow. Do not convert
this to `shared.base.json`: the regular merger would erase local state.

`eli` is a layout, not a color theme; the color theme is `arctic`, tracked in
`settings.json`. `eli` is a personal clone of the shipped `main` layout;
shipped files are never edited.
It uses a hidden sidebar (toggle with Ctrl+G, B), top tabs even for a single
tab, and square, gapless panes without individual pane headers. Borders appear
only when split. The old 48/24/72-character sidebar sizes are approximated as
400/200/600 logical pixels. Agent sorting defaults to priority in the shipped
Agents mod. The new app does not offer the old exact inner-border-only or
tab-bar hostname options; its stock status bar identifies the machine.

`eli-tabs` clones the stock tab bar but draws tinted glyphs in their program's
color instead of muted gray. `programs.json` makes Pi purple and replaces the
monochrome Neovim glyph with its blue/green logo in `program-icons/neovim.svg`
([source: Devicon](https://github.com/devicons/devicon/blob/master/icons/neovim/neovim-original.svg)).
Full-color pictures keep their original colors. These personal files survive
app restarts and upgrades; the shipped tab bar and icons remain untouched.

Unnamed tabs and the `eli-agents` sidebar display the Pi session name from its
live terminal title, without the `π -` prefix or working directory. Pi's
`auto-session-name.ts` extension generates that name and reassesses it after the
second and third user prompts. Explicit Herdr tab names always win; clear a tab's
name to resume following Pi. Duplicate automatic names within a space gain a
`· <tab position>` suffix. Split tabs use their first Pi pane, not whichever pane
has focus. Remote panes work through the same terminal-title stream; there is no
local session-file read or app-to-model request. These are display names, not
permanent `tab.rename` writes (CLI layout names remain unchanged).

Herdr sandboxes each mod's imports to its own directory, so `names.js` is present
in both personal mods; `tests/herdr-app-session-names.mjs` enforces identical copies.

`settings.json` disables sounds and terminal scrollbars and fixes appearance
to dark. Terminal and UI fonts select the app-local `Operator Mono Book Herdr`
family: Book / Book Italic for ordinary cells and Bold / Bold Italic only when
requested. Terminal Neovim uses that same renderer. The terminal size is 16px.

Herdr 0.1.13 only selects families and hardcodes Medium (500) for normal cells.
The installed original Operator fonts label Book as 325, Medium as 350 and
Bold as 400, causing family matching to select Bold even for ordinary text.
`scripts/prepare-herdr-fonts.py` creates an isolated family with corrected
selection metadata (Book=500, Bold=700), unique names, and **unchanged glyph
outlines**. System fonts are never modified. Generated fonts live in the
ignored `fonts/` folder, which Herdr loads itself; they are not installed
system-wide or committed.

`dot stow` runs the generator with uv. Install the licensed Book, Book Italic,
Bold and Bold Italic OTF files locally on each GUI machine first. The generator
looks in user/system font folders on macOS and Linux. Missing sources produce
an explicit warning; without the prepared family Herdr falls back to JetBrains
Mono. To prepare explicitly or use another source directory:

```sh
uv run scripts/prepare-herdr-fonts.py
uv run scripts/prepare-herdr-fonts.py --source-dir /path/to/licensed/fonts
```

Restart Herdr after regenerating fonts it has already loaded. This repo tracks
only the generator and settings, never the licensed files.

The Arctic theme uses the same terminal background, foreground and ANSI palette
as Ghostty/Neovim. UI backgrounds (canvas, bars, sidebars, surfaces and popovers)
match the terminal's `#1e1e1e`; hover, raised and selected states retain their
distinct highlight colors. Kitty graphics are supported by the app without an
experimental setting.

These behaviors are verified against Herdr app 0.1.13's source:
[`terminal_font` in settings.rs](https://github.com/herdrdev/herdr-app/blob/v0.1.13/src/settings.rs#L814-L822),
[`cell_font` in terminal.rs](https://github.com/herdrdev/herdr-app/blob/v0.1.13/src/terminal.rs#L1372-L1378),
and [startup layout selection](https://github.com/herdrdev/herdr-app/blob/v0.1.13/src/window.rs#L567-L572).
There is no separate default-layout setting in this version; startup reads
`shared.json`, which is why stow needs the small preference adapter.

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
python3 tests/herdr-app-config.py
uv run tests/herdr-font-preparation.py
# macOS after preparing fonts: verify native normal/bold/italic face selection.
swift tests/herdr-app-font.swift
node tests/herdr-app-navigation.mjs
node tests/herdr-app-tab-icons.mjs
node tests/herdr-app-session-names.mjs
nvim --headless -u NONE -l tests/herdr-app-navigation.lua
herdr-app check ~/.config/herdr-app/mods/navigator-status
herdr-app check ~/.config/herdr-app/mods/eli-tabs
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

`eli-spaces` is a personal clone of the shipped Spaces sidebar. Nested worktrees
show one name without the `repos` `<repo>@` prefix or a second branch suffix.
Automatic names use the branch; custom space names remain renamable and saved
names are unchanged. The label uses the available sidebar width and keeps
ahead/behind counters. Standalone rows keep their original git context.
Check with `node tests/herdr-app-spaces.mjs` and
`herdr-app check ~/.config/herdr-app/mods/eli-spaces`.

Each `eli-agents` row takes two lines. The first holds the tab title, which
can use the whole width up to the status and number. The second holds the
space, then, right-aligned, the machine (remote agents only) and the idle
time. Under a space header (grouped view) the second line leaves out the
space.

### Not migrated: no built-in equivalent

- Ctrl+G, E: edit scrollback; Ctrl+G, [: copy mode. Cmd+F searches scrollback;
  select text and Cmd+C to copy.
- Alt+Shift+H/J/K/L: resize panes (drag split dividers instead).
- Annotation/document-review plugin keys: Ctrl+G followed by A, Shift+A,
  Ctrl+A, M, O or Shift+O. They need a separate mod/CLI integration.
- The old pane navigation-mode H/J/K/L bindings. The tab/agent picker
  (Cmd+P) uses arrow keys and typing filters the list.

These missing actions are deliberately not bound to non-existent commands.
