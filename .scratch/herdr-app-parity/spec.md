# Herdr App gaps

Status: open

Things Herdr App (0.1.17) can't do that the Herdr TUI could, or that block a keyboard-only, dotfiles-managed setup. Upstream issues are in `herdrdev/herdr-app` unless they say `herdr-core`.

## Blocking

None as of 0.1.17.

## Resolved

| Gap | Fix |
|---|---|
| **Keyboard pane resize.** The TUI had Alt+Shift+H/J/K/L; the app could only drag dividers. | 0.1.17 ships `pane.resize {direction, pane?, px?}` ([#1087](https://github.com/herdrdev/herdr-app/pull/1087)), which moves the nearest divider 40px. `keys.json` binds Alt+Shift+H/J/K/L to it. |
| **Line height was hard-coded** to 1.15 × the font height, which was taller than Ghostty. | 0.1.15 sizes rows from the font's own metrics, matching Ghostty (`738fce4`, [#66](https://github.com/herdrdev/herdr-app/issues/66)). On master after 0.1.15, `68188d1` adds a `terminal_line_height` multiplier (default 1.0) and `6a0cbc0` centres glyphs in their cells the way Ghostty does. |

## Worked around

| Gap | Workaround | Upstream |
|---|---|---|
| **Keyboard copy mode.** The TUI had prefix `[`, hjkl motions, `v`/`V` to select and `y` to yank. Before 0.1.16 the app only let you select with the mouse. | The `copy-mode` mod on Ctrl+G [ (see the app README). Missing: word motions and search, because mods can't read terminal text. | [#360](https://github.com/herdrdev/herdr-app/issues/360): 0.1.16 shipped the selection API (`terminal.select`, `terminal.adjust_selection`, `terminal.clear_selection`, `selection` on `focused()`/`terminals()`) with no built-in copy mode. |
| **Agents can't open a tab or space without focusing it.** The TUI had `herdr tab create --no-focus`; before 0.1.16 the app's `tab.new` and `space.new` always focused what they opened. | `spawn-worker` and agent-status resume start terminals with `hc run --bg --keep --no-parent --label herdr.space=<id> --label herdr.tab=<new id>`, which the app adopts without focus. `repos` has opened `--no-focus` spaces the same way since eli0shin/repos#130; [eli0shin/repos#132](https://github.com/eli0shin/repos/pull/132) switches it to `space.new {focus: false}`. | [#447](https://github.com/herdrdev/herdr-app/issues/447): fixed in 0.1.16 (`focus: false` on `space.new`/`tab.new`, #602). |
| **Agent sessions don't resume after a restart.** Legacy herdr's `resume_agents_on_restore` resumed pi. | `hc-session-label.ts` labels the terminal with the session file and its shell's token, and `conf.d/hc-pi-resume.fish` runs `pi --session` on the first prompt of a reopened terminal. The first real reboot (2026-11-20) resumed every session, but the app showed them as `fish`, not agents: the resumed Pi never sent OSC 7501 status, because the reply to fish's startup DA query reached it before the 7501 reply, and it also ran in fish's process group. The hook now runs ` PI_PROGRAM_STATUS=1 pi --session …` from fish's command line; verified by SIGKILLing kept terminals, which came back as `pi`. herdr-core 0.1.21's `restore_screen` (on in `home/.config/herdr-core/config.toml`) also shows the lost screen above the new shell. | [#429](https://github.com/herdrdev/herdr-app/issues/429), [#406](https://github.com/herdrdev/herdr-app/issues/406), [herdr-core#15](https://github.com/herdrdev/herdr-core/issues/15): upstream waits until OSC 7501 can carry a resume reference. |
| **Config can't be managed as a dotfile.** The app reads `shared.json` once at launch and then rewrites it from memory, so edits made by `dot stow` while it's running are lost. | Stow pushes the values into the running app through `navigator-status.set-shared` (`f3cbcf4`). | No direct issue. Related: [#168](https://github.com/herdrdev/herdr-app/issues/168) |

## Comments
