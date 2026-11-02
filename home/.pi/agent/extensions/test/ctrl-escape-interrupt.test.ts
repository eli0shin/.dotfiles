import assert from "node:assert/strict";
import test from "node:test";
import { CustomEditor, getSelectListTheme, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, type KeyId, type TUI } from "@earendil-works/pi-tui";
import ctrlEscapeInterrupt, { enableCtrlEscapeInterrupt } from "../ctrl-escape-interrupt.ts";

initTheme();
function manager(binding: KeyId | KeyId[] = "ctrl+escape") {
  return new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "app.interrupt": { defaultKeys: "escape" },
  }, { "app.interrupt": binding });
}

for (const sequence of ["\x1b[27;5u", "\x1b[27;5;27~"]) {
  test(`Ctrl+Esc invokes the native editor interrupt handler: ${JSON.stringify(sequence)}`, () => {
    const keys = manager();
    const restore = enableCtrlEscapeInterrupt(keys);
    try {
      const editor = new CustomEditor(
        { terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI,
        { borderColor: (text) => text, selectList: getSelectListTheme() }, keys as never,
      );
      let interrupted = 0;
      editor.onEscape = () => { interrupted++; };
      editor.handleInput(sequence);
      assert.equal(interrupted, 1);
      editor.handleInput("\x1b");
      assert.equal(interrupted, 1, "plain Escape must not interrupt");
    } finally { restore(); }
  });
}

test("respects configured bindings, aliases, and live rebinding", () => {
  const keys = manager(["ctrl+esc", "ctrl+q"]);
  const restore = enableCtrlEscapeInterrupt(keys);
  assert.equal(keys.matches("\x1b[27;5u", "app.interrupt"), true);
  assert.equal(keys.matches("\x11", "app.interrupt"), true);
  assert.equal(keys.matches("\x1b[27;7u", "app.interrupt"), false);
  assert.equal(keys.matches("\x1b[27;5u", "tui.select.cancel"), false);
  assert.equal(keys.matches("\x1b", "tui.select.cancel"), true);
  keys.setUserBindings({ "app.interrupt": "escape" });
  assert.equal(keys.matches("\x1b[27;5u", "app.interrupt"), false);
  assert.equal(keys.matches("\x1b", "app.interrupt"), true);
  keys.setUserBindings({ "app.interrupt": [] });
  assert.equal(keys.matches("\x1b[27;5u", "app.interrupt"), false);
  restore();
});

test("restores the original matcher without overwriting a later adapter", () => {
  const keys = manager();
  const original = keys.matches;
  const restore = enableCtrlEscapeInterrupt(keys);
  restore(); restore();
  assert.equal(keys.matches, original);
  const restoreAgain = enableCtrlEscapeInterrupt(keys);
  const replacement = () => false;
  keys.matches = replacement;
  restoreAgain();
  assert.equal(keys.matches, replacement);
});

test("attaches once at session start and restores on shutdown; ignores non-terminal modes", () => {
  const handlers = new Map<string, Function>();
  ctrlEscapeInterrupt({ on: (event, handler) => { handlers.set(event, handler); } } as ExtensionAPI);
  const previous = getKeybindings();
  const keys = manager();
  const original = keys.matches;
  setKeybindings(keys);
  try {
    for (const mode of ["rpc", "json", "print"]) handlers.get("session_start")!({}, { mode });
    assert.equal(keys.matches, original);
    handlers.get("session_start")!({}, { mode: "tui" });
    assert.equal(keys.matches("\x1b[27;5u", "app.interrupt"), true);
    handlers.get("session_start")!({}, { mode: "tui" });
    handlers.get("session_shutdown")!();
    handlers.get("session_shutdown")!();
    assert.equal(keys.matches, original, "no stacked adapter survives shutdown");
  } finally {
    handlers.get("session_shutdown")!();
    setKeybindings(previous);
  }
});
