# AeroSpace current-workspace application launch

## Question

How can an application selected in the launcher always open its first window in the AeroSpace workspace that was focused when the user selected it?

## Finding

AeroSpace already assigns every newly detected window to its internally focused workspace. In AeroSpace 0.21.3-Beta, `MacWindow.getOrRegister` calls `unbindAndGetBindingDataForNewWindow` with `focus.workspace` for every new window detected after startup. The startup-only branch uses the window's screen position instead.

Source: [AeroSpace 0.21.3-Beta `MacWindow.swift`](https://github.com/nikitabobko/AeroSpace/blob/v0.21.3-Beta/Sources/AppBundle/tree/MacWindow.swift#L18-L33)

Therefore, a launcher does not need to detect the new window and move it after creation. It must preserve AeroSpace's focused workspace until AeroSpace detects the new window.

## Why the custom launcher caused visible workspace changes

The custom launcher hid itself before opening an application. Hiding removed its key panel and let macOS focus another off-screen application window. AeroSpace accepted that native focus change and changed `focus.workspace` before the new application window appeared. AeroSpace then correctly attached the new window to the now-wrong focused workspace.

The later polling code moved the window back after detection. That produced the visible sequence of wrong workspace, initial tiling, move, and second tiling.

Commit `75c10cb` removed this hide-then-repair sequence. Commit `9e7eb35` restored it while making the visible launcher close immediately after selection. A controlled GitHub Desktop launch on empty workspace 4 confirmed the regression:

```text
focused workspace  app window workspace
4                  -
3                  -
3                  3
4                  4
```

After the focus-sink fix in `1464585`, the same launch stayed on workspace 4 until the window appeared there. The visible launcher still closed immediately.

This conflicts with AeroSpace's normal launch model. The official command documentation shows application launch as a plain `exec-and-forget open ...`; it does not prescribe post-detection movement for opening an app on the current workspace.

Source: [AeroSpace `exec-and-forget` command](https://nikitabobko.github.io/AeroSpace/commands#exec-and-forget)

## Correct launcher protocol

For an application with no existing AeroSpace window:

1. Make the invisible launcher focus-sink panel key.
2. Remove the visible launcher panel, but do not hide the launcher application.
3. Request application activation/opening.
4. Keep the focus sink until AeroSpace detects the target window.
5. Let AeroSpace attach the new window directly to the unchanged `focus.workspace`.
6. Focus the target window, remove the focus sink, and hide the launcher application.

The visible panel can close immediately. The required invariant is that a launcher panel remains the native focus target until the application window exists.

For an application with an existing window, normal activation is correct: macOS focuses the application's existing window and AeroSpace follows that window's workspace.

For an explicit new-window action, the launcher can send the application's new-window command without first activating an existing window. The new window is then attached directly to the still-focused workspace.

## Closing and quitting windows

The same native focus fallback occurs when the last window on a workspace closes. A controlled `cmd-w` test on workspace 4 reproduced this sequence:

```text
focused workspace  focused app window
4                  Calculator
3                  -
```

A direct `cmd-w = "close"` binding cannot preserve the workspace because the focused window disappears before AeroSpace has another native focus target. The `aerospace-close` script now uses this protocol:

1. Capture the focused workspace and window ID.
2. Activate the launcher focus sink.
3. Close the captured window by ID.
4. Wait until AeroSpace removes the window.
5. Focus a remaining window on the captured workspace, or keep the focus sink if the workspace is empty.

`aerospace-quit` uses the same protocol around application termination. The focus-sink command must not return immediately after it sends `SIGUSR2`; signal delivery and AppKit activation are asynchronous. The launcher command now checks `NSWorkspace.frontmostApplication` and returns only after the launcher executable is frontmost. This removes the fixed-delay race for both close and quit.

## Relevant AeroSpace behavior

AeroSpace workspaces are emulated by placing inactive windows near a screen corner. macOS does not know the workspace association. AeroSpace's guide explicitly describes this model.

Source: [AeroSpace guide: Emulation of virtual workspaces](https://nikitabobko.github.io/AeroSpace/guide#emulation-of-virtual-workspaces)

`on-window-detected` callbacks target the newly detected window through `AEROSPACE_WINDOW_ID`. They are useful when a window must be assigned to a predetermined workspace. They are not required for the default rule of opening in the currently focused workspace.

Sources:

- [AeroSpace guide: `on-window-detected`](https://nikitabobko.github.io/AeroSpace/guide#on-window-detected-callback)
- [AeroSpace guide: callback environment and target forwarding](https://nikitabobko.github.io/AeroSpace/guide#environment-variables)

## Conclusion

Opening on the current AeroSpace workspace is supported by AeroSpace's core window-registration path. The launcher must preserve native focus, and thus `focus.workspace`, until the target window exists. Closing or quitting the last window requires the same focus-sink handoff. Post-detection movement can remain as a safety check, but it must not be the normal mechanism that repairs a visible workspace change.
