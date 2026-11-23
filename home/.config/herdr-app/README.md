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
It uses a hidden sidebar (toggle with Ctrl+G, B) that lists agents only (spaces
are in the Ctrl+G, S picker), top tabs even for a single
tab, and square panes without individual pane headers. The only line in the
layout is the one between split panes: panes have no frame, and a 1px gap
shows the tab block's `border` background between them, so a lone pane and a
split's outer edges are bare. The sidebar and tab bar draw no dividers
either, and the focused split has no outline (its cursor shows it). There is
no status bar row: terminals reach the window's bottom. Where the shown space
runs ("This computer" or its machine) ends the tab bar, in place of a new-tab
button (Cmd+T, Ctrl+G T), since it belongs to the space as its tabs do. No
branch (the prompt shows it) and no agent count.
The sidebar's top row (`eli-chrome`, a clone of `workspace-chrome`) and the
tab bar are both 38px: 6px above the 29px tabs and 3px below, with the
"Agents" label level with the tabs. No macOS traffic lights: Herdr has no
setting to hide them (`false` is rejected, `null` means the default spot, a
negative y drops them lower), but `"traffic_lights": [-80, 4]` parks them
past the window's left edge. Close and quit with Cmd+W / Cmd+Q / Ctrl+G D;
the tab bar's traffic-light inset follows the x, so it shrinks to its 10px
minimum. The blank
strip between a tab and the terminal's first row isn't the tab bar's: Herdr
centers the terminal grid in its pane, so the part of a row that doesn't fit
splits above and below it (0 to half a row, by window height), and no layout
or setting pins it to the top. The first
Agents section header sits right under the row. The row doubles as the Agents
list's header: the label, the machine filter and the sort, without the
brand, search or sidebar buttons (Cmd+P, Ctrl+G B). The old
48/24/72-character sidebar sizes are approximated as 400/200/600 logical
pixels. Agent sorting defaults to priority in the shipped Agents mod. The new
app does not offer the old tab-bar hostname option; the tab bar's machine
label stands in for it.

`eli-tabs` clones the stock tab bar but draws tinted glyphs in their program's
color instead of muted gray. `programs.json` makes Pi purple and replaces the
monochrome Neovim glyph with its blue/green logo in `program-icons/neovim.svg`
([source: Devicon](https://github.com/devicons/devicon/blob/master/icons/neovim/neovim-original.svg)).
Full-color pictures keep their original colors. These personal files survive
app restarts and upgrades; the shipped tab bar and icons remain untouched.

The Agents list (`eli-agents`) is the main way to reach agents, so `eli-tabs`
hides every tab that has an entry in `agents()`, even the active one. That
includes split tabs where an agent runs next to other panes. The bar shows
only the remaining tabs (editors, shells, and so on). The rule uses the same
source as the Agents list. A program that hasn't reported agent status keeps
its tab until it shows up in the list.

Tab keys never land on an agent's tab either:

- Numbered tabs (Cmd+1–9, Ctrl+G 1–9) count only the shown tabs. An
  unnamed tab's label is the same count, not its place among all tabs.
- Next/previous (Ctrl+G N/P, Ctrl+Tab, Ctrl+Shift+Tab, Cmd+Shift+]/[) and
  scrolling the bar step over hidden tabs, wrapping. On an agent's tab they
  move down/up the Agents list instead, wrapping, and never leave it for a
  tab.
- Closing the shown tab shows the nearest shown tab to its left, else to its
  right. Closing an agent's tab instead focuses the next agent in the Agents
  list order, wrapping and across spaces. It falls back to a shown tab only
  when no other agent is left.

`keys.json` binds these keys in the `eli` layout to `navigator-status.tab-N`,
`tab-next` and `tab-prev`, which use the same rule (`tab-order.js`). The app's
`tab.select {index}` and `tab.next`/`tab.prev` would count hidden tabs. The
Cmd+P picker still lists agents' tabs. Check with
`node tests/herdr-app-agent-tabs.mjs` and
`node tests/herdr-app-tab-close-focus.mjs`.

Pi's `auto-session-name.ts` extension generates the session name and
reassesses it after the second and third user prompts. Whenever Pi's name
changes (automatic or `/name`), and when a named session starts or resumes, the
extension writes it as the real tab name with `herdr-app do tab.rename`,
replacing whatever name the tab has. It writes only from interactive Pi and only
from a tab's first Pi pane, and does nothing when Pi's machine has no reachable
app.

Where Pi can't write (such as remote panes), unnamed tabs and the `eli-agents`
sidebar display the Pi session name from its live terminal title, without the
`π -` prefix or working directory. Duplicate display names within a space gain
a `· <tab position>` suffix, and split tabs use their first Pi pane, not
whichever pane has focus. There is no local session-file read or app-to-model
request.

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

## Resuming Pi after a reboot

Legacy herdr's `resume_agents_on_restore` has no app equivalent
([herdr-app#429](https://github.com/herdrdev/herdr-app/issues/429)). When a kept
terminal's program is lost (a reboot, a crash, a killed holder), herdr-core
reopens the terminal in place with a fresh login shell and keeps its labels.
Two pieces use that to bring Pi back:

- Pi's `hc-session-label.ts` labels the terminal with `dotfiles.pi_session`
  (the session file) and `dotfiles.pi_shell` (a token for the fish shell Pi
  runs under), and leaves a marker named after the token in
  `$XDG_STATE_HOME/dotfiles/hc-pi/`.
- `~/.config/fish/conf.d/hc-pi-resume.fish` gives each terminal's first shell
  a new token. On that shell's first prompt, a session labelled under another
  token is one the terminal was running when it was lost, so the shell runs
  `pi --session <file>` from its command line, as if typed. When Pi returns to
  the shell that ran it, the shell clears the labels, so a Pi you quit stays
  quit.

The Herdr app treats a terminal as an agent once Pi reports its status with
OSC 7501. Pi only reports after the terminal answers its 7501 query before the
DA reply, and on a reopened terminal's first prompt the reply to fish's own
startup DA query reaches Pi first, so the hook runs Pi with
`PI_PROGRAM_STATUS=1`. It runs Pi from the command line, not from the prompt
handler, because fish never hands the terminal to a command run from an event
handler.

It only looks at the labels once, when a terminal starts, and checks for a
marker file at each prompt. Check with `bash tests/hc-pi-resume.sh`.

## Keys

Native macOS shortcuts are retained. Prefix shortcuts are native GPUI
sequences: `ctrl-g c` means press Ctrl+G, release, then C (not Ctrl+G+C).

| After Ctrl+G | Action |
| --- | --- |
| C / S | Settings / spaces picker (`space-picker`) |
| K / J | Previous / next agent |
| Ctrl+S / X | New space in a picked folder (`new-space`) / close space |
| D | Close the window; core terminals keep running (legacy detach) |
| T / R | New / rename tab |
| P / N / 1–9 | Previous / next / numbered tab (skipping agents' tabs in `eli`) |
| Shift+1–9 / Shift+0 | Focus agent N / the tenth, in the Agents list order (`eli` layout) |
| / | Choose which machines' agents the Agents list shows (`agent-machines`) |
| F | Find which agent watches a PR (`pr-finder`) |
| Shift+Q | Close tab |
| V / H | Split right / down |
| Q | Close pane |
| B | Toggle sidebar |
| Ctrl+L | Send Ctrl+L to the terminal (clear shell screen) |

Alt+Shift+H/J/K/L resizes the focused pane, as in the TUI: `pane.resize`
(Herdr 0.1.17) moves the nearest divider 40px left, down, up or right,
whichever side of it the pane is on. It needs Option to act as Alt, which
Herdr does by default on US and ABC layouts (`option_as_alt`).

Ctrl+; (`eli` layout) jumps to any agent in two keys: it opens the `agent-jump`
bar, and the label each Agents row always shows brightens: 1–9 and 0, which
Ctrl+G Shift+1–0 also reach, then a, s, d, f… (home row first), or two
letters each past the tenth once there are more than 36 rows. Press a label
to focus that agent. Esc, Ctrl+; or a click elsewhere leaves. The bar holds
the keyboard, so letters never reach the terminal. It reads the order
`eli-agents` publishes, so the label you press is the row you see; a hidden
sidebar is shown for the jump and hidden again after. `jump.js` makes the
labels in both mods (sandboxing needs two identical copies). Check with
`node tests/herdr-app-agent-jump.mjs`.

### Neovim-aware Ctrl+H/J/K/L

This follows vim-tmux-navigator. In the `eli` layout, `navigator-status` (a
personal clone of the status bar, kept in the layout at zero height because
only shown mods get commands; it draws nothing) owns the chords. When Neovim is in front
of the focused terminal, it hands Neovim the key directly:
`nvim --server <its server> --remote-send <C-h>`, using `nvim` from PATH.
Neovim treats that exactly like a typed key. Neovim's local
`herdr-app-navigator` module labels its terminal
`dotfiles.navigator.editor=<v:servername>` at startup and on resume, and
clears it on suspend, `:detach` and exit; headless runs never set it. The
label works even when a wrapper leads the terminal (`fish -c` in the PR diff
tab, `git commit`, an agent's external editor). Without the label, the chords
always move to the adjacent Herdr pane. If the labelled Neovim is gone, the
mod clears the label and moves the pane.

It never uses `hc keys`: herdr-core holds agent keys until the person has
stopped typing in that terminal for ~3 s (`HC_QUIET_MS`), so a Ctrl+L right
after Alt+J in Diffview would wait 3 s.

In normal mode Neovim moves between its splits, then labels its core
terminal with a unique `dotfiles.navigator` request only at an edge. The app
consumes the request once, and only while its source terminal is still
focused. This also works with remote cores when these Neovim dotfiles are
installed there; the app reaches a remote server through `exec` on that
machine, and no remote `herdr-app` binary is required. Insert-mode keys keep
their normal Neovim behavior.

The bridge loads automatically for new Neovim sessions inside herdr-core.
For an already-open Neovim, run
`:lua package.loaded['herdr-app-navigator'] = nil; require('herdr-app-navigator').setup()`
to load the current module and claim its terminal. New sessions disable
conflicting tmux.nvim bindings automatically. Legacy Herdr keeps its existing plugin, nested
tmux keeps its own navigation, and ordinary terminals remain unchanged.
Other app layouts retain native pane navigation; use `eli` for the bridge.

Regression checks:

```sh
uv run tests/herdr-font-preparation.py
# macOS after preparing fonts: verify native normal/bold/italic face selection.
swift tests/herdr-app-font.swift
node tests/herdr-app-navigation.mjs
node tests/herdr-app-tab-icons.mjs
node tests/herdr-app-agent-tabs.mjs
node tests/herdr-app-session-names.mjs
bash tests/hc-pi-resume.sh
nvim --headless -u NONE -l tests/herdr-app-navigation.lua
herdr-app check ~/.config/herdr-app/mods/navigator-status
herdr-app check ~/.config/herdr-app/mods/eli-tabs
node tests/herdr-app-copy-mode.mjs
node tests/herdr-app-nvim-links.mjs
herdr-app check ~/.config/herdr-app/mods/nvim-links
herdr-app check ~/.config/herdr-app/mods/copy-mode
node tests/herdr-app-dead-spaces.mjs
```

The old Lumen Alt+J/K shell aliases also depend on the legacy pane API and
are not installed here; use Lumen's own controls instead.

### New space in a picked folder

A space keeps the folder it was made in: plain `space.new` takes the focused
terminal's folder at that moment, and nothing changes it afterwards (no
command sets an existing space's folder). `repos` and the default mods match
spaces by that folder, so `new-space` replaces `space.new` on Cmd+N and
Ctrl+G, Ctrl+S with a fuzzy folder picker. The focused terminal's folder is
first, so Enter right away behaves like plain `space.new`. Then come zoxide's
folders in frecency order and repos-tracked repos (`repos/config.json`) zoxide
hasn't seen; nothing is walked, so it opens instantly. Typing filters
fzf-style (every term must match, the folder's own name first); a typed `/…` or `~/…`
path is offered as is. ↑/↓ or Ctrl+P/Ctrl+N move, Enter makes the space, Esc
closes. In a space on another machine, it lists that machine's folders and
makes the space there. The tab picker's "new space" rows still run plain
`space.new`. Check with `node tests/herdr-app-new-space.mjs` and
`herdr-app check ~/.config/herdr-app/mods/new-space`.

### Closing spaces whose folder was deleted

`repos clean` closes a worktree's space, but other ways of removing a
worktree don't tell Herdr: `gh pr merge --delete-branch` run from the main
checkout removes the PR branch's linked worktree itself, as do a plain
`git worktree remove` and `rm -rf`. The space then lingers with a shell in a
folder that no longer exists.

In the `eli` layout, `navigator-status` (`dead-spaces.js`) checks every 30
seconds and closes such a space with a toast naming it. A space qualifies only
when all of these hold:

- it is on this computer and isn't the shown space;
- every live terminal in it is a plain shell: no agent, status report, editor
  or other program in front;
- its folder (home, for a space made without one) and each terminal's live
  folder are all gone.

It must qualify on two sweeps in a row with the same folders, so it closes 30–60
seconds after the folder goes, and a folder that is only briefly missing keeps
its space. A failed folder check closes nothing. Check with
`node tests/herdr-app-dead-spaces.mjs`.

### Spaces picker and numbered agents

`space-picker` restores the legacy workspace picker on Ctrl+G, S: it lists
spaces only, numbered in space order. Type to fuzzy-find a space: every
word must match, in any order, with the name ranked above the branch, folder
and machine (`mods/space-picker/match.js`). Arrows or Ctrl+N/P move, Enter
switches, Esc closes. The numbers are the Ctrl+1–9 that switch spaces
directly. The shipped tab/agent picker stays on Cmd+P. Check with
`node tests/herdr-app-space-picker.mjs`.

`eli-agents` is a personal clone of the shipped Agents list that ends each
row with its label (1–9, 0, then letters for Ctrl+;), so there's no counting.
Ctrl+G, Shift+1–9 and Shift+0 (bound as both `shift-1` and `!` spellings)
focus the first ten rows: the app has no
"focus agent N" command, so `eli-agents` publishes its order in shared state
and `navigator-status` focuses the Nth agent from it. When that order is
stale (the sidebar hasn't been shown since launch, so it isn't running),
`agent-order.js` mirrors the list's sort instead: pinned first, then by
priority (a parent takes its most urgent sub-agent's rank) or by space when
grouped. That fallback can differ from the list for an agent you're viewing
that just finished, for ties within a section, or for Pi workers (it doesn't
nest them); open the sidebar once (Ctrl+G, B) to use the exact order.

Each `eli-agents` row takes two lines. The first holds the tab title, which
can use the whole width up to the status and number. The second holds the
space in its space color (`colors.js`, the colors the shipped picker keeps in
shared `space.colors`), then, right-aligned, chips for an orchestrator's
workers and the PRs it watches, the machine (remote agents only) and the idle
time. Under a space header (grouped view) the second line leaves out the
space.

The type was picked in `docs/prototypes/herdr-agents-readability.prototype.html`
(variant H) to stop the rows reading as one block of small gray text, at a
size closer to the terminal's. Titles are 14.5px with no bold: live rows
(working, needs you, done) read near white with a left edge and their time in
the status color; idle titles sit a step under the theme's text. The selected
row has a faint wash and a thin outline of the working blue instead of a solid
block, so reading it is no jump from the rows around it. Rows have no pin
button: hovering never swaps the time for one. Agents pinned before keep
their Pinned section.

Pi's `pr-watch.ts` labels its terminal `dotfiles.pi_pr_watch` with its
orchestration role and the PRs it watches, named as in Pi's status line
(`#1901` in the current repo, `tool#7` elsewhere); `watch.js` reads it only
while the terminal runs Pi, and the fish hook clears it when Pi exits. The
second line shows those PRs as one chip: the first PR and how many more, the
whole list (with `· paused` when the watch is paused, and the chip italic) on
hover. Workers nest under their orchestrator with tree lines and take labels right after
it, shown only while the orchestrator or one of its workers is focused (no
fold button; the narrow rail shows them all). Workers leave out the space.
The orchestrator's second line names the Jira ticket its worker branches
share and counts its workers in a chip, and its PR chip covers every PR it
watches, even ones a worker also shows. A worker whose orchestrator isn't listed is
an ordinary row. The group's place follows the orchestrator's status, except
that any worker needing you moves it to Needs you and a working worker lifts
an idle orchestrator to Working; a done worker doesn't move it, since it
reports to the orchestrator. Check with `node tests/herdr-app-agent-watch.mjs`.

### Filtering agents by machine

On a computer connected to others, the Agents list can leave out machines:
Ctrl+G, / (or the screen button in the sidebar's top row) opens `agent-machines`.
↑/↓ or J/K move, Space shows or hides the machine under the cursor, Enter
shows only it and closes, Esc or Q closes; "All machines" shows every one.
The header button reads "N hidden" in blue while any are. The choice persists
in shared `dotfiles.agents.hidden-machines` (the hidden machines, `""` for
this computer, so a newly connected machine shows until hidden). Hidden
agents leave the list, its numbers, agent-jump, Ctrl+G Shift+1–0 and
tab-close focus; `agent.next`/`agent.prev` (Cmd+[ / ]) still reach them, since
the app appends agents the list leaves out. Check with
`node tests/herdr-app-agent-machines.mjs`.

### Finding a PR's agent (Ctrl+G, F)

The Agents list shows one PR per row, so `pr-finder` answers "which agent
owns this PR?": type a PR number, a repo, or both (`2032`, `ffs 2032`,
`tool#7`). Every term must match one PR; a number matches the PR number
(exact first), words match the repo (`match.js`). Rows look like the Agents
list's without the status, jump label or time, with the matched PRs as chips;
an orchestrator keeps its "N workers" chip, so a PR it shares with a worker
shows both and tells them apart. Enter focuses the agent. Machines hidden in
the Agents list stay hidden. Pi's PR watch label carries each PR's full
`refs` (`owner/repo#N`) for this; a Pi from before that falls back to its
space's name for `#N`. `names.js`, `watch.js` and `colors.js` are copies of
eli-agents'. Check with `node tests/herdr-app-pr-finder.mjs`.

### Review view (Cmd+R)

The review TUI (`review`, `~/code/code-review-tui`) is a view of Herdr rather
than a tab to hunt for. Cmd+R (`navigator-status.review`, in
`navigator-status/review-view.js`) shows this machine's review; on the review,
it goes back to the terminal you came from. With none running on the focused
space's machine, it starts one in the current space: review opens its Review
and Diff tabs in the space and folder it runs in, so press it first from the
space you review from. Its tab stays out of the tab bar and the tab keys, as
agents' tabs do. The terminal labels itself `dotfiles.review` (that's how
it's found, on any machine) and ends when review quits, so the next Cmd+R
starts a fresh one; Herdr core keeps it running across app restarts. A review
started by hand in a shell isn't labelled, so it stays an ordinary tab. Check
with `node tests/herdr-app-review-view.mjs`.

### File links open in Neovim

Cmd-click a file path in a terminal and `nvim-links` opens it in Neovim, in a
new split to the right of the pane you clicked in. A relative path is taken
from the folder of what runs in that pane; Herdr resolves it, along with `~/`.
`file.rs:42` and `file.rs:42:7` put the cursor there. Only the file types
`~/.local/bin/install-neovim-app` makes Neovim the editor for open this way;
everything else (images, PDFs, media, files without an extension), folders,
and paths that don't exist keep Herdr's usual opener.

In a pane on another machine, the mod (which runs in this window) asks that
machine with `hc exec --on` whether the path is a file there, relative to the
pane's folder there, and the split's terminal and Neovim run on that machine
too, as Herdr keeps a split on the machine of the pane it splits. Herdr has no
opener for remote files, so anything else there opens nothing. The `eli` layout turns it on with
`link_handlers`. Check with `node tests/herdr-app-nvim-links.mjs` and
`herdr-app check ~/.config/herdr-app/mods/nvim-links`.

### Copy mode

`copy-mode` brings back the TUI's Ctrl+G, [ on the selection commands added in
Herdr 0.1.16. A small bar at the top holds the keyboard while the cursor and
selection show in the focused terminal:

- h/j/k/l or arrows, 0 (first column), ^ and $ or End (first and last text on
  the row), g and G (top and bottom of history), H/M/L, Ctrl+U/D (half page),
  Ctrl+B/F or PageUp/PageDown move the cursor. The view follows it through the
  history. Mods can't read terminal text, so ^ and $ select the row as a line
  for a moment (Herdr trims its blanks) to find where the text starts and ends.
- v or Space selects characters and V selects lines. Press it again, or Esc,
  to drop the selection.
- y, Enter or Cmd+C copies the selection and leaves. q, Ctrl+C, a click
  outside the bar, or Esc with nothing selected leaves without copying.

Leaving clears the selection and scrolls back to the bottom. Word motions
(w/b/e) and search (/ ? n N) aren't there: the mod API doesn't expose
terminal text. Esc reaches the mod through the `mod:copy-mode` section of
`keys.json`; without it Esc would close the bar before the mod saw it.

### Not migrated: no built-in equivalent

- Ctrl+G, E: edit scrollback. Cmd+F searches scrollback.
- Annotation/document-review plugin keys: Ctrl+G followed by A, Shift+A,
  Ctrl+A, M, O or Shift+O. They need a separate mod/CLI integration.
- The old pane navigation-mode H/J/K/L bindings. The tab/agent picker
  (Cmd+P) uses arrow keys and typing filters the list.

These missing actions are deliberately not bound to non-existent commands.
