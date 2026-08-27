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

This conflicts with AeroSpace's normal launch model. The official command documentation shows application launch as a plain `exec-and-forget open ...`; it does not prescribe post-detection movement for opening an app on the current workspace.

Source: [AeroSpace `exec-and-forget` command](https://nikitabobko.github.io/AeroSpace/commands#exec-and-forget)

## Correct launcher protocol

For an application with no existing AeroSpace window:

1. Keep the launcher panel key and keep AeroSpace's focused workspace unchanged.
2. Request application activation/opening.
3. Do not hide the launcher first.
4. Let application activation deactivate the launcher panel naturally.
5. Let AeroSpace detect the first window and attach it directly to `focus.workspace`.

For an application with an existing window, normal activation is correct: macOS focuses the application's existing window and AeroSpace follows that window's workspace.

For an explicit new-window action, the launcher can send the application's new-window command without first activating an existing window. The new window is then attached directly to the still-focused workspace.

## Relevant AeroSpace behavior

AeroSpace workspaces are emulated by placing inactive windows near a screen corner. macOS does not know the workspace association. AeroSpace's guide explicitly describes this model.

Source: [AeroSpace guide: Emulation of virtual workspaces](https://nikitabobko.github.io/AeroSpace/guide#emulation-of-virtual-workspaces)

`on-window-detected` callbacks target the newly detected window through `AEROSPACE_WINDOW_ID`. They are useful when a window must be assigned to a predetermined workspace. They are not required for the default rule of opening in the currently focused workspace.

Sources:

- [AeroSpace guide: `on-window-detected`](https://nikitabobko.github.io/AeroSpace/guide#on-window-detected-callback)
- [AeroSpace guide: callback environment and target forwarding](https://nikitabobko.github.io/AeroSpace/guide#environment-variables)

## Conclusion

Opening on the current AeroSpace workspace is supported by AeroSpace's core window-registration path. The launcher must stop fighting that path. Preserve `focus.workspace` until detection and remove post-detection workspace movement for normal launches.
