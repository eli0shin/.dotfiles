# Herdr scrollback editor border

## Finding

For Herdr 0.8.0, set this global UI option:

```toml
[ui]
pane_borders = false
```

Then reload the running server:

```sh
herdr server reload-config
```

This removes the one-cell border from the scrollback editor. It also removes borders from normal split panes. Herdr 0.8.0 has no separate option for only the scrollback editor border.

Neovim can reduce the usable text width further with its number, sign, and fold columns. Herdr gives scrollback files the stable name pattern `herdr-scrollback-*.txt` ([v0.8.0 source](https://github.com/herdrdev/herdr/blob/v0.8.0/src/app/input/navigate.rs#L1848-L1880)), so a targeted Neovim `BufWinEnter` autocommand can disable those columns only for Herdr scrollback files. This repo defines that autocommand in `home/.config/nvim/lua/autocommands.lua`.

## Why this works

`keys.edit_scrollback` opens the focused pane scrollback in `$EDITOR` ([official config reference](https://herdr.dev/docs/config-reference/#keysedit_scrollback)). The implementation launches that editor as an overlay pane and zooms its tab ([v0.8.0 source](https://github.com/herdrdev/herdr/blob/v0.8.0/src/app/input/navigate.rs#L923-L948), [overlay setup](https://github.com/herdrdev/herdr/blob/v0.8.0/src/app/input/navigate.rs#L1045-L1117)).

For a zoomed tab, Herdr gives the focused terminal `Borders::ALL` when the layout has more than one pane and `ui.pane_borders` is enabled. Otherwise, it gives the terminal `Borders::NONE` ([v0.8.0 resize path](https://github.com/herdrdev/herdr/blob/v0.8.0/src/ui/panes.rs#L170-L188), [v0.8.0 render path](https://github.com/herdrdev/herdr/blob/v0.8.0/src/ui/panes.rs#L225-L247)). The overlay is implemented by adding a temporary second pane, so the default border reduces the editor terminal by one cell on every side. Disabling pane borders lets the editor use the complete pane area. The already configured `pane_scrollbars = false` also prevents Herdr from reserving a scrollbar column.

The official reference defines `ui.pane_borders` as “Draw borders around split panes” and confirms that it defaults to `true` ([official config reference](https://herdr.dev/docs/config-reference/#uipane_borders)). The full default config from the installed `herdr 0.8.0` lists no scrollback-editor-specific border option.

## Scope

This gives the editor the complete Herdr terminal area inside the current tab/sidebar layout. If the source terminal was one full-size pane, the editor gets the same row and column count after borders and scrollbars are disabled. If the source terminal was one pane in a split layout, the zoomed editor is larger than that source pane because the overlay is full-tab.

## Pi scrollback limitation

The scrollback editor and Herdr copy mode can only read rows that remain in Herdr's terminal buffer. Pi 0.84.0 regular mode sends `CSI 3 J` (`ESC[3J`) during a full redraw. That sequence explicitly clears terminal scrollback ([installed Pi TUI source behavior](https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui-main-screen.ts), [Pi issue #6050](https://github.com/earendil-works/pi/issues/6050)). Herdr recognizes this sequence but filters it only for Droid compatibility; other foreground applications retain normal clear-history semantics ([Herdr v0.8.0 source](https://github.com/herdrdev/herdr/blob/v0.8.0/src/pane/osc.rs#L709-L758)).

Therefore, `advanced.scrollback_limit_bytes` cannot restore cleared Pi history. Both `prefix+[` and built-in `prefix+e` can show only the post-clear rows. A live check against the affected pane returned the same 63 lines for `visible`, `recent`, and `recent-unwrapped`, with `max_offset_from_bottom = 0`.

Pi 0.84.0 provides `tuiMode = "fullscreen"` (or `--tui-mode fullscreen`). Fullscreen mode keeps the transcript in Pi's own scroll view. PageUp/PageDown, Home/End, Ctrl+Shift+Up/Down, and the mouse wheel navigate it. This avoids destructive host-scrollback redraws, but Herdr copy mode still has no host scrollback to navigate. Herdr's documented alternate-screen automation can collect up to 1,000 rows by driving an idle recognized agent's mouse-scroll interface, but the built-in scrollback editor does not use that path; it calls `recent_text(usize::MAX)` directly ([Herdr editor source](https://github.com/herdrdev/herdr/blob/v0.8.0/src/app/input/navigate.rs#L923-L942), [agent automation](https://herdr.dev/docs/agent-automation/#alternate-screen-history-reads)).
