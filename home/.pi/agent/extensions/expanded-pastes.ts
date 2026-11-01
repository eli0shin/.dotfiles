import { CustomEditor, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type TUI } from "@earendil-works/pi-tui";

// Pi 1.4 has no setting for its 1,000-character / 10-line paste collapse.
// Adapt only the current prompt editor, retaining the native paste pipeline's
// normalization, filtering, path spacing, cursor placement, and atomic undo.
type PasteEditor = {
  handlePaste: (text: string) => void;
  insertTextAtCursorInternal: (text: string) => void;
  pastes: Map<number, string>;
  pasteCounter: number;
};

export function expandPastes(editor: CustomEditor, version = VERSION): (() => void) | undefined {
  const state = editor as unknown as PasteEditor;
  if (!/^1\.4\./.test(version) || typeof state.handlePaste !== "function" ||
      typeof state.insertTextAtCursorInternal !== "function" || !(state.pastes instanceof Map) ||
      typeof state.pasteCounter !== "number") return undefined;

  const original = state.handlePaste;
  const handlePaste = (text: string) => {
    const previousCounter = state.pasteCounter;
    const insert = state.insertTextAtCursorInternal;
    state.insertTextAtCursorInternal = (content) => {
      // A newly stored paste means native handlePaste is about to insert its
      // marker. Substitute the already-cleaned text before onChange sees it.
      const expanded = state.pasteCounter > previousCounter ? state.pastes.get(state.pasteCounter) : undefined;
      if (expanded !== undefined) {
        state.pastes.delete(state.pasteCounter);
        state.pasteCounter = previousCounter;
        insert.call(editor, expanded);
      } else insert.call(editor, content);
    };
    try {
      original.call(editor, text);
    } finally {
      state.insertTextAtCursorInternal = insert;
    }
  };
  state.handlePaste = handlePaste;
  return () => {
    if (state.handlePaste === handlePaste) state.handlePaste = original;
  };
}

export function findPromptEditor(tui: Pick<TUI, "children">): CustomEditor | undefined {
  const pending: Component[] = [...tui.children];
  const visited = new Set<Component>();
  for (const component of pending) {
    if (visited.has(component)) continue;
    visited.add(component);
    if (component instanceof CustomEditor) return component;
    const children = (component as { children?: Component[] }).children;
    if (Array.isArray(children)) pending.push(...children);
  }
  return undefined;
}

export default function expandedPastes(pi: ExtensionAPI): void {
  let restore: (() => void) | undefined;
  let stopWaiting: (() => void) | undefined;
  const cleanup = () => {
    stopWaiting?.();
    stopWaiting = undefined;
    restore?.();
    restore = undefined;
  };
  pi.on("session_start", async (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui") return;
    // Obtain the existing editor without replacing it, taking focus, or adding
    // a widget. Closing inside the factory prevents a dialog from mounting.
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      const attach = () => {
        const editor = findPromptEditor(tui);
        if (!editor) return false;
        restore = expandPastes(editor);
        if (!restore) ctx.ui.notify("Expanded pastes: unsupported Pi editor/version; using native paste behavior.", "warning");
        return true;
      };
      if (!attach()) {
        // During /reload, session_start runs while a loading panel occupies the
        // editor slot. Terminal listeners run before editor input dispatch, so
        // attach after remount without losing even the first bracketed paste.
        stopWaiting = ctx.ui.onTerminalInput(() => {
          if (attach()) {
            stopWaiting?.();
            stopWaiting = undefined;
          }
          return undefined;
        });
      }
      done();
      return new Container();
    });
  });
  pi.on("session_shutdown", cleanup);
}
