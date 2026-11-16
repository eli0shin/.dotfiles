# Herdr App gaps

Status: open

Things Herdr App (0.1.16) can't do that the Herdr TUI could, or that block a keyboard-only, dotfiles-managed setup. Upstream issues are in `herdrdev/herdr-app` unless they say `herdr-core`.

## Blocking

| Gap | Upstream |
|---|---|
| **Keyboard pane resize.** Panes can only be resized by dragging the divider. Since 0.1.14, `layout.resize --id <pane> --weight N` sets a pane's share of its split, but only to an absolute size. Mods still can't see pane geometry or the parent split in 0.1.16, so they can't step a divider. | [#117](https://github.com/herdrdev/herdr-app/issues/117). [PR #991](https://github.com/herdrdev/herdr-app/pull/991) by romangolev (Nov 13) adds `pane.resize {direction, px?, pane?}`, which moves the nearest divider by 10px by default, with Cmd+Ctrl+arrow defaults on macOS. Superseded: [PR #1087](https://github.com/herdrdev/herdr-app/pull/1087) by darkwebber merged `pane.resize {direction, pane?, px?}` to master on Nov 16 (`d1dee7f`, after 0.1.16). It moves the nearest border 40px by default, in the direction given whichever side of it the pane is on, like tmux. It ships no default keys; once released, bind Alt+Shift+H/J/K/L in `keys.json`. #991 and #117 are still open. |

## Resolved

| Gap | Fix |
|---|---|
| **Line height was hard-coded** to 1.15 × the font height, which was taller than Ghostty. | 0.1.15 sizes rows from the font's own metrics, matching Ghostty (`738fce4`, [#66](https://github.com/herdrdev/herdr-app/issues/66)). On master after 0.1.15, `68188d1` adds a `terminal_line_height` multiplier (default 1.0) and `6a0cbc0` centres glyphs in their cells the way Ghostty does. |

## Worked around

| Gap | Workaround | Upstream |
|---|---|---|
| **Keyboard copy mode.** The TUI had prefix `[`, hjkl motions, `v`/`V` to select and `y` to yank. Before 0.1.16 the app only let you select with the mouse. | The `copy-mode` mod on Ctrl+G [ (see the app README). Missing: word motions and search, because mods can't read terminal text. | [#360](https://github.com/herdrdev/herdr-app/issues/360): 0.1.16 shipped the selection API (`terminal.select`, `terminal.adjust_selection`, `terminal.clear_selection`, `selection` on `focused()`/`terminals()`) with no built-in copy mode. |
| **Agents can't open a tab or space without focusing it.** The TUI had `herdr tab create --no-focus`; before 0.1.16 the app's `tab.new` and `space.new` always focused what they opened. | `spawn-worker` and agent-status resume start terminals with `hc run --bg --keep --no-parent --label herdr.space=<id> --label herdr.tab=<new id>`, which the app adopts without focus. `repos work`/`stack`/`clean` (in `~/code/repos`) still move focus and could now pass `focus: false`. | [#447](https://github.com/herdrdev/herdr-app/issues/447): fixed in 0.1.16 (`focus: false` on `space.new`/`tab.new`, #602). |
| **Agent sessions don't resume after a restart.** Legacy herdr's `resume_agents_on_restore` resumed pi. | `hc-session-label.ts` labels the terminal with the session file and its shell's token, and `conf.d/hc-pi-resume.fish` runs `pi --session` on the first prompt of a reopened terminal. Tested against a scratch herdr-core by killing its holder. Not yet tested through a real reboot. herdr-core 0.1.21's `restore_screen` (on in `home/.config/herdr-core/config.toml`) also shows the lost screen above the new shell. | [#429](https://github.com/herdrdev/herdr-app/issues/429), [#406](https://github.com/herdrdev/herdr-app/issues/406), [herdr-core#15](https://github.com/herdrdev/herdr-core/issues/15): upstream waits until OSC 7501 can carry a resume reference. |
| **Config can't be managed as a dotfile.** The app reads `shared.json` once at launch and then rewrites it from memory, so edits made by `dot stow` while it's running are lost. | Stow pushes the values into the running app through `navigator-status.set-shared` (`f3cbcf4`). | No direct issue. Related: [#168](https://github.com/herdrdev/herdr-app/issues/168) |

## Comments
