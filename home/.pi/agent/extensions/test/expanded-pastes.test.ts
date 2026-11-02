import assert from "node:assert/strict";
import test from "node:test";
import { CustomEditor, getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import expandedPastes, { expandPastes, findPromptEditor } from "../expanded-pastes.ts";

initTheme();
const longText = "This is dictated text that I need to read and edit. ".repeat(30);
const undo = "\x1b[45;5u";
function editor() {
  return new CustomEditor({ terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI,
    { borderColor: (text) => text, selectList: getSelectListTheme() }, { matches: () => false } as never);
}
function paste(target: CustomEditor, text: string) { target.handleInput(`\x1b[200~${text}\x1b[201~`); }

for (const [name, text] of [
  ["long single-line dictation", longText],
  ["many short lines", Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")],
  ["Unicode", "世界 🧑🏽‍💻 cafe\u0301 ".repeat(120)],
] as const) {
  test(`${name} stays visible and editable without paste markers`, () => {
    const target = editor();
    assert.ok(expandPastes(target));
    const changes: string[] = [];
    target.onChange = (text) => changes.push(text);
    paste(target, text);
    assert.equal(target.getText(), text);
    assert.equal(target.getExpandedText(), text);
    assert.deepEqual(changes, [text], "onChange never observes an intermediate marker");
    assert.doesNotMatch(target.render(100).map(stripTerminalSequences).join("\n"), /\[paste #\d/);
    target.handleInput("\x7f");
    assert.notEqual(target.getText(), "", "backspace edits the text instead of deleting an atomic marker");
    assert.ok(target.getText().length < text.length);
  });
}

test("native cleanup, tabs, CRLF, control decoding and file-path spacing are preserved", () => {
  for (const text of ["small paste", "a\r\nb\rc\td\u0007", "one\x1b[106;5utwo", "/tmp/" + "path".repeat(300)]) {
    const native = editor();
    const expanded = editor();
    native.setText("prefix"); expanded.setText("prefix");
    expandPastes(expanded);
    paste(native, text); paste(expanded, text);
    assert.equal(expanded.getText(), native.getExpandedText());
  }
});

test("pasting in the middle preserves surrounding text and places the cursor after the paste", () => {
  const target = editor();
  target.setText("before|after");
  target.handleInput("\x01");
  for (let i = 0; i < 7; i++) target.handleInput("\x1b[C");
  expandPastes(target);
  paste(target, longText);
  assert.equal(target.getText(), `before|${longText}after`);
  assert.deepEqual(target.getCursor(), { line: 0, col: 7 + longText.length });
});

test("a paste is one undo operation, separate from edits typed afterward", () => {
  const target = editor();
  target.setText("before ");
  expandPastes(target);
  paste(target, longText);
  target.handleInput("X");
  target.handleInput(undo);
  assert.equal(target.getText(), `before ${longText}`);
  target.handleInput(undo);
  assert.equal(target.getText(), "before ");
});

test("fragmented bracketed paste stays one atomic insertion", () => {
  const target = editor();
  expandPastes(target);
  target.handleInput(`\x1b[200~${longText.slice(0, 100)}`);
  target.handleInput(longText.slice(100, 900));
  assert.equal(target.getText(), "");
  target.handleInput(`${longText.slice(900)}\x1b[201~`);
  assert.equal(target.getText(), longText);
  target.handleInput(undo);
  assert.equal(target.getText(), "");
});

test("literal paste-marker text is never mistaken for the newly generated marker", () => {
  const target = editor();
  expandPastes(target);
  const text = `[paste #1 1234 chars]\n${longText}`;
  paste(target, text);
  assert.equal(target.getText(), text);
  assert.equal(target.getExpandedText(), text);
});

test("submitted content matches the editable draft and keeps normal submit behavior", () => {
  const target = editor();
  expandPastes(target);
  let submitted: string | undefined;
  target.onSubmit = (text) => { submitted = text; };
  paste(target, longText);
  target.handleInput("\x7f");
  const draft = target.getText();
  target.handleInput("\r");
  assert.equal(submitted, draft);
});

test("cleanup restores native paste behavior and per-paste insertion methods", () => {
  const target = editor();
  const state = target as unknown as { handlePaste: Function; insertTextAtCursorInternal: Function };
  const original = state.handlePaste;
  const insert = state.insertTextAtCursorInternal;
  const restore = expandPastes(target)!;
  paste(target, longText);
  assert.equal(state.insertTextAtCursorInternal, insert);
  restore();
  assert.equal(state.handlePaste, original);
  target.setText("");
  paste(target, longText);
  assert.match(target.getText(), /^\[paste #1 \d+ chars\]$/);
  assert.equal(target.getExpandedText(), longText);
});

test("insertion method is restored even if an onChange handler throws", () => {
  const target = editor();
  const state = target as unknown as { insertTextAtCursorInternal: Function };
  const insert = state.insertTextAtCursorInternal;
  expandPastes(target);
  target.onChange = () => { throw new Error("test handler failure"); };
  assert.throws(() => paste(target, longText), /test handler failure/);
  assert.equal(state.insertTextAtCursorInternal, insert);
});

test("existing native paste entries are left alone and new entries do not leak", () => {
  const target = editor();
  paste(target, "old ".repeat(300));
  const oldDraft = target.getText();
  expandPastes(target);
  paste(target, longText);
  assert.equal(target.getText(), oldDraft + longText);
  const state = target as unknown as { pastes: Map<number, string>; pasteCounter: number };
  assert.equal(state.pastes.size, 1);
  assert.equal(state.pasteCounter, 1);
});

test("unsupported editor shapes fail open", () => {
  assert.equal(expandPastes({} as CustomEditor), undefined);
});

test("prompt discovery finds the existing shallow editor and tolerates cycles", () => {
  const root = new Container();
  const document = new Container();
  document.addChild(document);
  const prompt = new Container();
  const target = editor();
  prompt.addChild(target);
  root.children = [document, prompt];
  assert.equal(findPromptEditor(root), target);
  assert.equal(findPromptEditor({ children: [] }), undefined);
});

test("session reload does not stack adapters and shutdown restores the same editor", async () => {
  const handlers = new Map<string, Function>();
  expandedPastes({ on: (name: string, handler: Function) => handlers.set(name, handler) } as never);
  const target = editor();
  const original = (target as unknown as { handlePaste: Function }).handlePaste;
  const ctx = { mode: "tui", ui: {
    custom: async (factory: Function) => factory({ children: [target] }, {}, {}, () => {}),
    notify: () => assert.fail("supported editor should not warn"),
  } };
  await handlers.get("session_start")!({}, ctx);
  await handlers.get("session_start")!({}, ctx);
  paste(target, longText);
  assert.equal(target.getText(), longText);
  handlers.get("session_shutdown")!({}, ctx);
  assert.equal((target as unknown as { handlePaste: Function }).handlePaste, original);
});

test("reload waits for the prompt editor to remount without warning and handles the first paste", async () => {
  const handlers = new Map<string, Function>();
  expandedPastes({ on: (name: string, handler: Function) => handlers.set(name, handler) } as never);
  const root = new Container();
  root.addChild(new Container()); // Pi's reload loading panel, not its editor.
  const warnings: string[] = [];
  let input: ((data: string) => unknown) | undefined;
  let subscribed = false;
  const ctx = { mode: "tui", ui: {
    custom: async (factory: Function) => factory(root, {}, {}, () => {}),
    notify: (text: string) => warnings.push(text),
    onTerminalInput: (handler: (data: string) => unknown) => {
      input = handler;
      subscribed = true;
      return () => { subscribed = false; };
    },
  } };
  await handlers.get("session_start")!({}, ctx);
  assert.deepEqual(warnings, [], "a temporarily unmounted editor is not unsupported");
  assert.equal(subscribed, true);
  assert.equal(input!("ignored while reloading"), undefined);
  assert.equal(subscribed, true);
  const target = editor();
  const original = (target as unknown as { handlePaste: Function }).handlePaste;
  root.children = [target];
  const data = `\x1b[200~${longText}\x1b[201~`;
  assert.equal(input!(data), undefined, "listener must not consume or rewrite the first paste");
  assert.equal(subscribed, false, "no permanent per-keystroke tree scan");
  target.handleInput(data);
  assert.equal(target.getText(), longText);
  handlers.get("session_shutdown")!({}, ctx);
  assert.equal((target as unknown as { handlePaste: Function }).handlePaste, original);
});

test("shutdown removes a pending editor-remount listener", async () => {
  const handlers = new Map<string, Function>();
  expandedPastes({ on: (name: string, handler: Function) => handlers.set(name, handler) } as never);
  let subscribed = false;
  const ctx = { mode: "tui", ui: {
    custom: async (factory: Function) => factory({ children: [] }, {}, {}, () => {}),
    notify: () => assert.fail("missing editor should wait"),
    onTerminalInput: () => { subscribed = true; return () => { subscribed = false; }; },
  } };
  await handlers.get("session_start")!({}, ctx);
  assert.equal(subscribed, true);
  handlers.get("session_shutdown")!({}, ctx);
  assert.equal(subscribed, false);
});

test("non-TUI sessions never request custom UI", async () => {
  const handlers = new Map<string, Function>();
  expandedPastes({ on: (name: string, handler: Function) => handlers.set(name, handler) } as never);
  for (const mode of ["rpc", "json", "print"]) {
    await handlers.get("session_start")!({}, { mode, ui: { custom() { assert.fail("no TUI outside interactive mode"); } } });
  }
});
