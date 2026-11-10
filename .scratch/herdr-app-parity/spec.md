# Herdr App gaps

Status: open

Things Herdr App (0.1.14) can't do that the Herdr TUI could, or that block a keyboard-only, dotfiles-managed setup. Upstream issues are in `herdrdev/herdr-app` unless they say `herdr-core`.

## Blocking

| Gap | Upstream |
|---|---|
| **Keyboard copy mode.** The TUI had prefix `[`, hjkl motions, `v`/`V` to select and `y` to yank. The app only lets you select with the mouse. | [#360](https://github.com/herdrdev/herdr-app/issues/360): a selection API (`terminal.select`, `adjust_selection`) was proposed on Nov 7, with no maintainer reply and no PR. |
| **Keyboard pane resize.** Panes can only be resized by dragging the divider. | [#117](https://github.com/herdrdev/herdr-app/issues/117): romangolev offered to implement `pane.resize` on Nov 7. |
| **Line height is hard-coded** to 1.15 × the font height (`cell_size()`), which is too tall, and there's no setting for it. | [#66](https://github.com/herdrdev/herdr-app/issues/66) (9 reactions, several +1s), [PR #67](https://github.com/herdrdev/herdr-app/pull/67) (adds the setting, open since Oct 29, needs review), [#595](https://github.com/herdrdev/herdr-app/issues/595) |

## Worked around

| Gap | Workaround | Upstream |
|---|---|---|
| **Agents can't open a tab or space without focusing it.** The TUI had `herdr tab create --no-focus`; the app's `tab.new` and `space.new` always focus what they open, so worker spawns, session resumes and `repos work`/`stack`/`clean` pulled Eli out of the session he was in. repos's `--no-focus` only moves focus back afterwards. | Start the terminal with `hc run --bg --keep --no-parent --label herdr.space=<id> --label herdr.tab=<new id>`. The app adopts it into that space and tab (a new id makes a new one) without focus; `space.rename` and `tab.rename` don't move focus either. `spawn-worker` and agent-status resume do this. repos itself still moves focus. | [#447](https://github.com/herdrdev/herdr-app/issues/447): asks for a `focus` argument on `space.new`/`tab.new`. Open since Nov 3, no reply. |
| **Config can't be managed as a dotfile.** The app reads `shared.json` once at launch and then rewrites it from memory, so edits made by `dot stow` while it's running are lost. | Stow pushes the values into the running app through `navigator-status.set-shared` (`f3cbcf4`). | No direct issue. Related: [#168](https://github.com/herdrdev/herdr-app/issues/168) |

## To verify

| Gap | Notes | Upstream |
|---|---|---|
| **Agent sessions may not resume after a restart.** After the holder restart on 2026-11-09, terminals came back as shells. They were restored from the `dotfiles.pi_session` label. Check whether our label-based resume covers a normal restart. | Other users report the same thing. | [#429](https://github.com/herdrdev/herdr-app/issues/429) (pi), [#406](https://github.com/herdrdev/herdr-app/issues/406), [herdr-core#15](https://github.com/herdrdev/herdr-core/issues/15) |

## Comments
