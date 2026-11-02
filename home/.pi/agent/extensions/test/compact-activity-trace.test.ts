import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CustomMessageComponent, ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Text, TuiAltScreen, TuiMainScreen, stripTerminalSequences, type Terminal, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { createInteractiveTuiReference } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js";
import compactActivity, { installActivityView, observeActivityInput } from "../compact-activity/index.ts";
import { ActivityTrace, MAX_TRACE_BYTES, TRACE_TAG, type TraceRecord } from "../compact-activity/trace.ts";

const directory = mkdtempSync(join(tmpdir(), "compact-activity-trace-"));
after(() => rmSync(directory, { recursive: true, force: true }));
initTheme();

function memoryTrace() {
  const events: TraceRecord[] = [];
  const trace = new ActivityTrace("test-session", { enabled: true, sink: (event) => events.push(event) });
  return { trace, events };
}
function tool(id = "test") {
  const tool = new ToolExecutionComponent("bash", id, { command: "PRIVATE COMMAND" }, {}, {
    renderCall: () => new Text("PRIVATE COMMAND", 0, 0),
    renderResult: () => new Text("PRIVATE OUTPUT", 0, 0),
  }, { requestRender() {} } as never, "/private/path");
  tool.updateResult({ content: [{ type: "text", text: "PRIVATE OUTPUT" }], isError: false });
  return tool;
}
function click(y: number, height: number): TuiMouseEvent {
  return { type: "click", button: "left", x: 2, y, screenX: 2, screenY: y, width: 80, height } as TuiMouseEvent;
}
function setup(globalExpanded = false) {
  const { trace, events } = memoryTrace();
  const chat = new Container(); chat.addChild(tool());
  const installed = installActivityView(chat, () => {}, (text) => text, () => globalExpanded, (text) => text, trace);
  return { ...installed, chat, trace, events,
    render: () => chat.render(80).map(stripTerminalSequences),
    setGlobal: (expanded: boolean) => { globalExpanded = expanded; },
  };
}

test("tracing records expansion causes, identity, and global state without transcript content", () => {
  const h = setup();
  let output = h.render();
  const created = h.events.find((event) => event.event === "group-state")!;
  assert.equal(created.reason, "create");
  assert.equal(created.expanded, false);
  assert.equal(created.globalExpanded, false);
  assert.equal(created.override, null);
  const count = h.events.length;
  h.render(); h.chat.invalidate(); h.render();
  assert.equal(h.events.length, count, "unchanged redraws must not spam the log");

  h.chat.handleMouse(click(1, output.length));
  output = h.render();
  const opened = h.events.find((event) => event.reason === "mouse-summary")!;
  assert.equal(opened.group, created.group);
  assert.equal(opened.before, false);
  assert.equal(opened.expanded, true);
  assert.equal(opened.globalExpanded, false);
  assert.equal(opened.override, true);
  assert.equal(h.events.find((event) => event.event === "group-mouse")?.screenY, 1);

  h.chat.handleMouse(click(output.length - 1, output.length)); h.render();
  assert.equal(h.events.find((event) => event.reason === "mouse-collapse")?.expanded, false);
  h.setGlobal(true); h.render();
  const global = h.events.find((event) => event.reason === "global-change")!;
  assert.equal(global.expanded, true);
  assert.equal(global.override, null);
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE|\/private\/path/);
});

test("new groups, membership updates, shortcut peeks and resets are distinguishable", () => {
  const h = setup(); h.render();
  h.view.toggleLatestGroup(); h.render();
  assert.equal(h.events.find((event) => event.reason === "shortcut")?.expanded, true);
  h.chat.addChild(tool("second")); h.render();
  assert.equal(h.events.find((event) => event.reason === "update" && event.members === 2)?.expanded, true);
  h.chat.addChild(new Text("PRIVATE PROSE", 0, 0)); h.chat.addChild(tool("third")); h.render();
  const groups = h.events.filter((event) => event.event === "group-state" && event.reason === "create");
  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].group, groups[1].group);
  assert.equal(groups[1].expanded, false);
  assert.equal(h.events.find((event) => event.reason === "newer-block")?.expanded, false);
  h.view.resetExpansion(false); h.render();
  assert.equal(h.events.find((event) => event.event === "expansion-reset")?.expanded, false);
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE/);
});

test("nested tool and PR notification expansion is observed separately from outer groups", () => {
  const h = setup(); h.render();
  (h.chat.children[0] as ToolExecutionComponent).setExpanded(true); h.render();
  assert.ok(h.events.some((event) => event.event === "group-state" && event.expandedTools === 1 && !event.expanded));
  const notice = new CustomMessageComponent({ role: "custom", customType: "pr-watch-harness",
    content: "PRIVATE NOTIFICATION", display: true, timestamp: 0 },
    (_message, { expanded }) => new Text(expanded ? "PRIVATE NOTIFICATION" : "notification", 0, 0));
  h.chat.addChild(notice); h.render();
  h.view.toggleLatestGroup(); h.render();
  assert.ok(h.events.some((event) => event.event === "notification-expansion" && event.reason === "shortcut" && event.expanded));
  notice.setExpanded(false); h.render();
  assert.ok(h.events.some((event) => event.event === "notification-state" && event.before === true && !event.expanded));
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE/);
});

test("checkpoints observe the displayed state without reconciling or collapsing peeks in either display mode", () => {
  for (const compact of [true, false]) {
    const h = setup();
    const notice = new CustomMessageComponent({ role: "custom", customType: "pr-watch-harness",
      content: "PRIVATE NOTIFICATION", display: true, timestamp: 0 },
      (_message, { expanded }) => new Text(expanded ? "PRIVATE NOTIFICATION" : "notification", 0, 0));
    h.chat.addChild(notice); h.view.toggleLatestGroup(); h.render();
    assert.match(notice.render(80).join("\n"), /PRIVATE NOTIFICATION/);
    h.view.enabled = compact;
    h.chat.addChild(tool("newer"));
    if (!compact) h.render();
    const count = h.events.length;
    h.view.traceSnapshot();
    assert.match(notice.render(80).join("\n"), /PRIVATE NOTIFICATION/, "a diagnostic checkpoint must not collapse the visible notification");
    assert.ok(h.events.slice(count).some((event) => event.event === "notification-state" && event.reason === "snapshot" && event.expanded));
    assert.ok(!h.events.slice(count).some((event) => event.reason === "newer-block"));
  }
});

test("input tracing only retains allowlisted control metadata, never typed or pasted content", () => {
  const { trace, events } = memoryTrace();
  for (const input of ["a", "SECRET TOKEN", "\x1b[200~SECRET PASTE\x1b[201~", "\x1b]52;c;SECRET\x07"]) trace.input(input);
  assert.equal(events.length, 0);
  for (const input of ["\x1b[I", "\x1b[O", "\x0f", "\x1b[111;6u", "\x1b[<0;12;3M", "\x1b[<0;12;3m"]) trace.input(input);
  assert.deepEqual(events.map((event) => event.kind), ["focus-in", "focus-out", "global-shortcut", "latest-shortcut", "mouse", "mouse"]);
  assert.equal(events.at(-1)?.release, true);
  assert.equal(events.at(-1)?.x, 12);
  assert.ok(events.every((event) => event.tag === TRACE_TAG && event.sessionId === "test-session"));
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(events.map((event) => event.runId)).size, 1);
  assert.doesNotMatch(JSON.stringify(events), /SECRET|\\u001b/);
});

test("trace files rotate, disabled tracing is silent, and failed writes cannot break rendering", () => {
  const path = join(directory, "rotation.jsonl");
  const trace = new ActivityTrace("rotate", { path, enabled: true });
  trace.record("first");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  truncateSync(path, MAX_TRACE_BYTES);
  trace.record("second");
  assert.equal(statSync(`${path}.1`).size, MAX_TRACE_BYTES);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).event, "second");
  const disabled = new ActivityTrace("off", { enabled: false, sink: () => assert.fail("disabled trace wrote") });
  disabled.input("\x0f"); disabled.record("test");
  const blocked = join(directory, "not-a-directory"); writeFileSync(blocked, "file");
  const broken = new ActivityTrace("broken", { path: join(blocked, "trace.jsonl"), enabled: true });
  assert.doesNotThrow(() => broken.record("test"));
  const chat = new Container(); chat.addChild(tool());
  installActivityView(chat, () => {}, (text) => text, () => false, (text) => text, broken);
  assert.doesNotThrow(() => chat.render(80));
});

test("real fullscreen dispatch traces consumed focus/mouse input before routing, and follows renderer replacements", () => {
  let input!: (data: string) => void;
  const terminal: Terminal = {
    columns: 80, rows: 24, kittyProtocolActive: false,
    start(onInput) { input = onInput; }, stop() {}, async drainInput() {},
    write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {},
    clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  const originalStart = terminal.start;
  const { trace, events } = memoryTrace();
  let renderer: TUI = new TuiAltScreen(terminal);
  const reference = createInteractiveTuiReference(() => renderer);
  const chat = new Container(); chat.addChild(tool());
  installActivityView(chat, () => {}, (text) => text, () => false, (text) => text, trace);
  renderer.addChild(chat); renderer.start(); renderer.renderNow();
  const stopObserving = observeActivityInput(reference, trace);
  try {
    input("\x1b[I"); input("\x1b[O");
    const row = (renderer as TuiAltScreen).getScreenLines().findIndex((line) => stripTerminalSequences(line).includes("+ 1 command")) + 1;
    assert.ok(row > 0);
    input(`\x1b[<0;3;${row}M`); renderer.renderNow();
    input(`\x1b[<0;3;${row}m`); renderer.renderNow();
    assert.deepEqual(events.filter((event) => event.event === "terminal-input").map((event) => event.kind),
      ["focus-in", "focus-out", "mouse", "mouse"]);
    const release = events.find((event) => event.kind === "mouse" && event.release)!;
    const expansion = events.find((event) => event.reason === "mouse-summary")!;
    assert.ok(Number(release.seq) < Number(expansion.seq), "input is observed before its expansion handler");
    assert.equal(expansion.expanded, true, "observing must not interfere with native mouse routing");

    renderer.stop();
    renderer = new TuiMainScreen(terminal);
    renderer.addChild(chat); renderer.start(); renderer.renderNow();
    const typed: string[] = [];
    renderer.setFocus({ render: () => [], invalidate() {}, handleInput(data) { typed.push(data); } });
    input("SECRET TYPED TEXT"); input("\x0f");
    assert.deepEqual(typed, ["SECRET TYPED TEXT", "\x0f"], "input is forwarded unchanged");
    assert.equal(events.filter((event) => event.kind === "global-shortcut").length, 1);

    renderer.stop();
    renderer = new TuiAltScreen(terminal);
    renderer.addChild(chat); renderer.start(); renderer.renderNow();
    input("\x1b[I");
    assert.equal(events.filter((event) => event.kind === "focus-in").length, 2);
    assert.equal(events.filter((event) => event.event === "input-observer" && event.supported).length, 3);
    stopObserving();
    const count = events.length;
    input("\x1b[I");
    assert.equal(events.length, count, "cleanup removes the observer from the current renderer");
    assert.equal(terminal.start, originalStart);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|SECRET/);
  } finally {
    stopObserving(); renderer.stop();
  }
});

test("new TUI sessions trace automatically, expose a checkpoint, and remove listeners on replacement/shutdown", async () => {
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousTrace = process.env.PI_COMPACT_ACTIVITY_TRACE;
  process.env.PI_CODING_AGENT_DIR = directory;
  delete process.env.PI_COMPACT_ACTIVITY_TRACE;
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const listeners = new Set<(data: string) => void>();
  let removed = 0;
  const notices: string[] = [];
  compactActivity({ on: (name: string, handler: Function) => handlers.set(name, handler), registerShortcut() {},
    registerCommand: (name: string, command: { handler: Function }) => commands.set(name, command),
  } as never);
  const chat = new Container(); chat.addChild(tool());
  const document = new Container(); document.children = [new Container(), new Container(), chat];
  const tui = { children: [document], mode: "fullscreen", terminal: { start() {} }, inputListeners: listeners,
    requestRender() {}, addInputListener(listener: (data: string) => void) {
    listeners.add(listener); return () => { removed++; listeners.delete(listener); };
  } };
  const ctx = { mode: "tui", sessionManager: { getSessionId: () => "lifecycle-test" }, ui: {
    custom: async (factory: Function) => factory(tui, {}, {}, () => {}),
    theme: { fg: (_color: string, text: string) => text }, getToolsExpanded: () => false,
    notify: (text: string) => notices.push(text),
  } };
  try {
    await handlers.get("session_start")!({}, ctx);
    assert.equal(listeners.size, 1);
    chat.render(80);
    for (const listener of listeners) assert.equal(listener("\x1b[I"), undefined, "tracing must not consume input");
    await commands.get("activity")!.handler("trace", ctx);
    assert.match(notices.at(-1)!, /compact-activity\.jsonl/);
    await handlers.get("session_start")!({}, ctx);
    assert.equal(listeners.size, 1);
    assert.equal(removed, 1);
    handlers.get("session_shutdown")!({}, ctx);
    handlers.get("session_shutdown")!({}, ctx);
    assert.equal(listeners.size, 0);
    assert.equal(removed, 2);
    const events = readFileSync(join(directory, "logs", "compact-activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.event === "session-start").length, 2);
    assert.equal(events.filter((event) => event.event === "session-stop").length, 2);
    assert.ok(events.some((event) => event.reason === "snapshot"));
    assert.ok(events.some((event) => event.kind === "focus-in"));
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
  } finally {
    handlers.get("session_shutdown")!({}, ctx);
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousTrace === undefined) delete process.env.PI_COMPACT_ACTIVITY_TRACE; else process.env.PI_COMPACT_ACTIVITY_TRACE = previousTrace;
  }
});
