# Compact activity

Collapse consecutive tool calls and reasoning into an OpenCode-style activity line:

```text
+ 3 commands, 8 reads, 2 edits

The fix is to preserve the original session state.
```

Normal assistant text, user messages, and notices remain visible. Every error and warning goes into the activity group's details and isn't counted: provider errors, truncation, cancellation, and all `Error:`/`Warning:` statuses. Summaries show only general commands/custom tools, reads, and edits (both `write` and `edit` calls). There are no thought counts, failure counts, or transient running labels. Failed tools and reasoning remain inside expandable details; thought- and error-only groups are invisible while collapsed and accessible through `Ctrl+Shift+O` or global expansion.

- Images returned by tools remain visible below collapsed summaries, in order, without filenames or tool boxes. They flow left-to-right and wrap into rows, respecting their existing width/height caps and aspect ratios. This preserves CAD renders, UI screenshots, and other visual progress while using less vertical space.
- Click a summary's visible text to open or close that group (fullscreen mode); blank space on the row does not toggle it. Expanded groups also have a `− collapse` control at the bottom with the same text-only hit area, so closing them never requires finding the header again. Individual tool toggles stay independent. The standalone image previews disappear while expanded; each image appears once, in its original tool position.
- Open groups show Pi's tool information without shell backgrounds or vertical padding; tool text follows the transcript's `outputPad` indentation. Click a tool for its output. Failed results are red text without background fills. Other foreground colors, diffs, and mouse handling are preserved.
- `Ctrl+Shift+O` toggles the most recent group, whatever it contains, without expanding individual tool output or showing status notices. A group opened with this shortcut automatically collapses when a newer group appears; more activity joining the same group does not close it. Mouse-opened groups stay independent; explicit global expansion takes precedence.
- `Ctrl+O` still expands/collapses all groups and tool output, including thought- and error-only groups. The redundant `Tool output: expanded/collapsed` transcript notices are hidden in compact mode.
- `/activity full` restores the normal Pi transcript.
- `/activity compact` returns to grouping (the default).
- `/activity expand` and `/activity collapse` provide command equivalents to global expansion.

This directory is automatically discovered under `~/.pi/agent/extensions`. Run `/reload` to activate it in an existing session. The existing `collapsed-bash-calls.ts` renderer still applies inside expanded groups. Regular terminal mode supports keyboard/command expansion; native terminal scrollback cannot retroactively collapse already-scrolled output as fullscreen mode can.

## Temporary expansion diagnostics

New TUI sessions automatically write `[DEBUG-compact-activity]` records to `~/.pi/agent/logs/compact-activity.jsonl` (or the corresponding `PI_CODING_AGENT_DIR` directory). Existing sessions need `/reload`. Logging does not change expansion behavior.

Records include session/run IDs, timestamps, stable in-memory group/member IDs, group creation and expansion transitions, local overrides, the observed global expansion flag, nested-tool expansion counts, summary/footer clicks, shortcut handlers, and display-mode/width changes. Terminal input is allowlisted to normalized focus events, expansion shortcuts, and SGR mouse coordinates/buttons; ordinary keys, pasted text, messages, tool arguments/results, and working-directory paths are not recorded. The Pi 1.4 adapter observes input before fullscreen viewport consumption and follows regular/fullscreen renderer replacements; it preserves the original routing and restores its hooks on cleanup. Unchanged redraws do not generate group-state records. The shared log rotates at 5 MiB to one `.1` backup; logging failures are ignored.

To test, start a fresh session and use it normally, including phone reconnects. If a group unexpectedly opens, run `/activity trace` **before collapsing it** to append a checkpoint and show the log location. Report the approximate time/session so its records can be correlated. This is instrumentation, not a confirmed fix for hands-free expansion.

Set `PI_COMPACT_ACTIVITY_TRACE=0` before launching Pi to disable tracing. The probes are temporary and should be removed once the cause is captured.

## Compatibility

Experimental adapter for **Pi 1.4.x**. Pi exposes individual tool renderers but no transcript-grouping API, so this extension replaces the rendering and mouse routing of the session's chat container. It reads a few private assistant/tool metadata fields; that version-specific code lives in `index.ts` and `tool-view.ts`. Expanded tools project known Pi layout primitives without their backgrounds/vertical padding, restoring the transcript's horizontal indentation; custom component implementations render unchanged. Expanded previews and single-image rows reuse Pi's original image components. Multi-image gallery rows are cached transparent PNG strips built with Pi's own Photon dependency and orientation handling: Pi's line renderer cannot reliably compose multiple independent terminal graphics on one line. Strips use native image rendering for protocol handling, scrolling, and clipping; composition failures retain the original vertical previews. It never rewrites the container's original children, changes tool execution, or modifies messages/model context.

Unsupported versions/layouts fall back to Pi's normal transcript with a warning. Shutdown and reload restore the original methods. RPC, JSON, and print modes are untouched. HTML exports retain their ordinary rendering rather than these interactive groups.

Tests use real Pi assistant/tool components and cover grouping, interleaved prose, errors, cancellation, streaming updates, mouse routing, global expansion, restoration, narrow terminal widths, Kitty/iTerm image previews, wrapped galleries and pixel order, keyboard toggling, quiet status handling, and background-free expanded tools.
