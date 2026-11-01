import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  createReadToolDefinition,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container, Spacer, Text, stripTerminalSequences, visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ThemedText } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/themed-text.js";
import compactActivity, { ActivityGroup, findChat, installActivityView } from "../compact-activity/index.ts";

initTheme();
const ui = { requestRender() {} } as TUI;
function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop") {
  return new AssistantMessageComponent({ role: "assistant", content, stopReason,
    api: "openai-responses", provider: "openai", model: "test", timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
}
function thought(text = "Checking source") { return assistant([{ type: "thinking", thinking: text }]); }
function notification(content = "PR DETAILS", customType = "pr-watch-harness") {
  return new CustomMessageComponent({ role: "custom", customType, content, display: true, timestamp: 0 },
    (_message, { expanded }) => new Text(`${expanded ? "▾" : "▸"} pr-watch-notification${expanded ? `\n${content}` : ""}`, 0, 0));
}
let id = 0;
function tool(name = "bash", error = false, running = false) {
  const component = new ToolExecutionComponent(name, `tool-${++id}`, { path: "file.ts" }, {}, {
    renderCall: () => new Text(`${name} file.ts`, 0, 0),
    renderResult: (_result, _options, _theme, context) => new Text(context.isError ? "PERMISSION DENIED" : "FILE CONTENT", 0, 0),
  }, ui, "/tmp");
  if (!running) component.updateResult({ content: [{ type: "text", text: "result" }], isError: error });
  return component;
}
function setup(children: Container["children"], expanded = false) {
  const chat = new Container();
  chat.children = children;
  let globalExpanded = expanded;
  let redraws = 0;
  const installed = installActivityView(chat, () => { redraws++; }, (text) => text, () => globalExpanded);
  return { chat, ...installed, setExpanded: (value: boolean) => { globalExpanded = value; }, redraws: () => redraws };
}
function lines(component: Container, width = 80) { return component.render(width).map((line) => stripTerminalSequences(line).trimEnd()); }
function click(y: number, height: number): TuiMouseEvent {
  return { type: "click", button: "left", x: 2, y, screenX: 2, screenY: y, width: 80, height } as TuiMouseEvent;
}

test("eight range reads and thoughts occupy one summary, not thirty padded lines", () => {
  const children = [thought(), ...Array.from({ length: 8 }, () => tool("read")), thought()];
  const { chat } = setup(children);
  assert.deepEqual(lines(chat), ["", " + 8 reads"]);
  assert.deepEqual(chat.children, children, "the actual transcript tree is not rewritten");
});

test("assistant prose, users and custom entries stay visible while failed tools stay grouped", () => {
  const { chat } = setup([
    new Text("USER MESSAGE", 0, 0), thought(), tool(),
    assistant([{ type: "text", text: "Here is what matters." }]),
    tool("edit"), tool("bash", true), tool("write"), new Text("CUSTOM NOTICE", 0, 0),
  ]);
  const output = lines(chat).join("\n");
  assert.match(output, /USER MESSAGE/);
  assert.match(output, /\+ 1 command/);
  assert.match(output, /Here is what matters\./);
  assert.match(output, /\+ 1 command, 2 edits/);
  assert.match(output, /CUSTOM NOTICE/);
  assert.doesNotMatch(output, /PERMISSION DENIED|FILE CONTENT/);
});

test("mixed thinking and prose are split in order without changing model messages", () => {
  const message = assistant([
    { type: "thinking", thinking: "First reasoning" }, { type: "text", text: "First answer" },
    { type: "thinking", thinking: "Second reasoning" }, { type: "text", text: "Second answer" },
  ]);
  const original = message.render(80);
  const { chat } = setup([message]);
  const output = lines(chat).join("\n");
  assert.match(output, /First answer[\s\S]*Second answer/);
  assert.doesNotMatch(output, /thought|details/);
  assert.doesNotMatch(output, /First reasoning|Second reasoning/);
  assert.deepEqual(message.render(80), original);
});

test("click opens and closes a group; native rows remain clickable inside it", () => {
  const native = tool();
  const { chat, redraws } = setup([thought("THE REASONING"), native]);
  let output = lines(chat);
  assert.equal(chat.handleMouse(click(1, output.length))?.handled, true);
  output = lines(chat);
  assert.match(output.join("\n"), /THE REASONING/);
  assert.match(output.join("\n"), /FILE CONTENT/);
  const nativeLine = output.findIndex((line) => line.includes("bash file.ts"));
  chat.handleMouse(click(nativeLine, output.length));
  assert.equal((native as unknown as { expanded: boolean }).expanded, true);
  chat.handleMouse(click(1, output.length));
  assert.deepEqual(lines(chat), ["", " + 1 command"]);
  assert.equal(redraws(), 2);
});

test("expanded groups can be collapsed from their bottom without changing individual tool state", () => {
  const native = tool();
  native.setExpanded(true);
  const { chat, redraws } = setup([thought(), native]);
  let output = lines(chat);
  assert.doesNotMatch(output.join("\n"), /− collapse/);
  chat.handleMouse(click(1, output.length));
  output = lines(chat);
  assert.equal(output.at(-1), " − collapse");
  const footer = output.length - 1;
  chat.handleMouse({ ...click(footer, output.length), button: "right" });
  assert.match(lines(chat).join("\n"), /FILE CONTENT/);
  assert.equal(chat.handleMouse(click(footer, output.length))?.handled, true);
  assert.deepEqual(lines(chat), ["", " + 1 command"]);
  assert.equal((native as unknown as { expanded: boolean }).expanded, true);
  assert.equal(redraws(), 2);
});

test("the bottom collapse control closes only its own group when multiple groups are expanded", () => {
  const { chat } = setup([tool(), new Text("BETWEEN", 0, 0), tool("read")], true);
  let output = lines(chat);
  assert.equal(output.filter((line) => line === " − collapse").length, 2);
  const firstFooter = output.indexOf(" − collapse");
  chat.handleMouse(click(firstFooter, output.length));
  output = lines(chat);
  assert.match(output.join("\n"), /\+ 1 command[\s\S]*BETWEEN[\s\S]*− 1 read/);
  assert.equal(output.filter((line) => line === " − collapse").length, 1);
  chat.handleMouse(click(output.lastIndexOf(" − collapse"), output.length));
  output = lines(chat);
  assert.doesNotMatch(output.join("\n"), /FILE CONTENT|− collapse/);
  assert.match(output.join("\n"), /\+ 1 command[\s\S]*BETWEEN[\s\S]*\+ 1 read/);
});

test("bottom collapse remains clickable after expanded contents change height", () => {
  const details = new Text("one", 0, 0);
  const group = new ActivityGroup(() => {}, (text) => text);
  group.update([{ key: details, component: details, kind: "command" }], true);
  lines(group);
  details.setText("one\ntwo\nthree\nfour");
  const output = lines(group);
  group.handleMouse(click(output.lastIndexOf(" − collapse"), output.length));
  assert.deepEqual(lines(group), ["", " + 1 command"]);
});

test("thought-only groups stay silent until global expansion and can collapse locally", () => {
  const { chat, setExpanded } = setup([thought("DETAIL")]);
  assert.deepEqual(lines(chat), []);
  setExpanded(true);
  const output = lines(chat);
  assert.match(output.join("\n"), /DETAIL/);
  chat.handleMouse(click(1, output.length));
  assert.deepEqual(lines(chat), []);
  setExpanded(false);
  lines(chat);
  setExpanded(true);
  assert.match(lines(chat).join("\n"), /DETAIL/);
});

test("explicit expansion commands clear local group and tool overrides even if global state is unchanged", () => {
  const source = tool();
  const { chat, view, setExpanded } = setup([source]);
  lines(chat);
  chat.handleMouse(click(1, 2));
  source.setExpanded(true);
  view.resetExpansion(false);
  assert.deepEqual(lines(chat), ["", " + 1 command"]);
  assert.equal((source as unknown as { expanded: boolean }).expanded, false);

  setExpanded(true);
  const expandedLines = lines(chat);
  chat.handleMouse(click(1, expandedLines.length));
  assert.deepEqual(lines(chat), ["", " + 1 command"]);
  source.setExpanded(false);
  view.resetExpansion(true);
  assert.match(lines(chat).join("\n"), /− 1 command/);
  assert.match(lines(chat).join("\n"), /FILE CONTENT/);
  assert.equal((source as unknown as { expanded: boolean }).expanded, true);
});

test("fast tool completion and failure do not change or flicker the summary", () => {
  const running = tool("bash", false, true);
  const { chat } = setup([tool(), running]);
  const before = lines(chat);
  assert.deepEqual(before, ["", " + 2 commands"]);
  running.updateResult({ content: [{ type: "text", text: "error" }], isError: true });
  const output = lines(chat);
  assert.deepEqual(output, before);
  chat.handleMouse(click(1, output.length));
  assert.match(lines(chat).join("\n"), /PERMISSION DENIED/);
});

test("multiple failed tools and successful retries remain one expandable activity run", () => {
  const children = [thought(), tool("bash", true), tool("bash", true), tool("bash"), thought()];
  const { chat, setExpanded } = setup(children);
  assert.deepEqual(lines(chat), ["", " + 3 commands"]);
  assert.deepEqual(chat.children, children);
  setExpanded(true);
  const expanded = lines(chat).join("\n");
  assert.equal(expanded.match(/PERMISSION DENIED/g)?.length, 2);
  assert.match(expanded, /FILE CONTENT/);
  setExpanded(false);
  assert.deepEqual(lines(chat), ["", " + 3 commands"]);
});

test("summary shows only commands, reads and edits, with writes counted as edits", () => {
  const running = tool("custom_tool", false, true);
  const { chat } = setup([thought(), tool("bash", true), tool("read"), tool("write"), tool("edit"), running]);
  assert.deepEqual(lines(chat), ["", " + 2 commands, 1 read, 2 edits"]);
  running.updateResult({ content: [{ type: "text", text: "done" }], isError: false });
  assert.deepEqual(lines(chat), ["", " + 2 commands, 1 read, 2 edits"]);
});

test("empty assistant tool declarations do not separate groups", () => {
  const { chat } = setup([tool(), assistant([{ type: "toolCall", id: "call", name: "read", arguments: {} }]), tool()]);
  assert.deepEqual(lines(chat), ["", " + 2 commands"]);
});

for (const reason of ["error", "aborted", "length"] as const) {
  test(`${reason} joins the activity group, with or without thinking`, () => {
    for (const content of [[], [{ type: "thinking", thinking: "SECRET THOUGHT" }]] as AssistantMessage["content"][]) {
      const { chat, setExpanded } = setup([tool(), assistant(content, reason)]);
      assert.deepEqual(lines(chat), ["", " + 1 command"]);
      setExpanded(true);
      assert.match(lines(chat).join("\n"), /Error:|Operation aborted|truncated/);
    }
  });
}

function stallWarning(attempt: number) {
  return new ThemedText(() =>
    `Warning: Anthropic request stalled (no response after 25s); resending (${attempt}/2)`, 1, 0);
}
function timeout() {
  const component = assistant([], "error");
  component.updateContent({ ...(component as unknown as { lastMessage: AssistantMessage }).lastMessage,
    errorMessage: "Request timed out." });
  return component;
}

test("stall resend warnings and provider errors stay inside the collapsed group", () => {
  const children = [tool(), tool("edit"), new Spacer(1), stallWarning(1), new Spacer(1), stallWarning(2), timeout(),
    new Spacer(1), stallWarning(1), new Spacer(1), stallWarning(2), thought(), tool()];
  const { chat, setExpanded } = setup(children);
  assert.deepEqual(lines(chat), ["", " + 2 commands, 1 edit"]);
  assert.deepEqual(chat.children, children);
  setExpanded(true);
  const expanded = lines(chat).join("\n");
  assert.equal(expanded.match(/request stalled/g)?.length, 4);
  assert.match(expanded, /Error: Request timed out\./);
});

test("every error and warning status is grouped", () => {
  const other = new ThemedText(() => "Warning: something else", 1, 0);
  const final = new ThemedText(() => "Error: Retry failed after 3 attempts: Request timed out.", 1, 0);
  const { chat, setExpanded } = setup([tool(), stallWarning(1), timeout(), new Spacer(1), final,
    new Text("USER MESSAGE", 0, 0), tool(), new Spacer(1), other]);
  assert.deepEqual(lines(chat), ["", " + 1 command", "USER MESSAGE", "", " + 1 command"]);
  setExpanded(true);
  const expanded = lines(chat).join("\n");
  assert.match(expanded, /Error: Request timed out\.[\s\S]*Retry failed after 3 attempts[\s\S]*something else/);
});

for (const [name, child] of [["thought", () => thought("ONLY THOUGHT")], ["error", () => timeout()]] as const) {
  test(`Ctrl+Shift+O opens and closes a ${name}-only group`, () => {
    const { chat, view } = setup([tool(), assistant([{ type: "text", text: "PROSE" }]), child()]);
    assert.doesNotMatch(lines(chat).join("\n"), /ONLY THOUGHT|Request timed out/);
    view.toggleLatestGroup();
    const output = lines(chat).join("\n");
    assert.match(output, /\+ 1 command[\s\S]*PROSE[\s\S]*− details[\s\S]*(ONLY THOUGHT|Request timed out)/);
    view.toggleLatestGroup();
    assert.doesNotMatch(lines(chat).join("\n"), /ONLY THOUGHT|Request timed out|− /);
  });
}

test("Ctrl+Shift+O always toggles the latest group, whatever it contains", () => {
  const { chat, view } = setup([tool()]);
  view.toggleLatestGroup();
  chat.addChild(assistant([{ type: "text", text: "PROSE" }]));
  chat.addChild(thought("LATER THOUGHT"));
  assert.doesNotMatch(lines(chat).join("\n"), /\u2212 |LATER THOUGHT/, "a newer group ends the peek");
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /\+ 1 command[\s\S]*\u2212 details[\s\S]*LATER THOUGHT/);
});

test("theme invalidation and streaming thought updates keep first-group click state", () => {
  const source = thought("Before");
  const { chat } = setup([source, tool()]);
  lines(chat);
  chat.handleMouse(click(1, 2));
  chat.invalidate();
  assert.match(lines(chat).join("\n"), /Before/);
  const message = (source as unknown as { lastMessage: AssistantMessage }).lastMessage;
  source.updateContent({ ...message, content: [{ type: "thinking", thinking: "After" }] }, true);
  assert.match(lines(chat).join("\n"), /After/);
});

test("compact/full switching and cleanup restore the exact original methods", () => {
  const chat = new Container();
  chat.addChild(thought()); chat.addChild(tool());
  const original = { render: chat.render, mouse: chat.handleMouse, invalidate: chat.invalidate };
  const originalLines = chat.render(80);
  const { view, restore } = installActivityView(chat, () => {}, (text) => text, () => false);
  assert.notDeepEqual(chat.render(80), originalLines);
  view.enabled = false;
  assert.deepEqual(chat.render(80), originalLines);
  view.enabled = true;
  restore();
  assert.equal(chat.render, original.render);
  assert.equal(chat.handleMouse, original.mouse);
  assert.equal(chat.invalidate, original.invalidate);
});

test("groups respect narrow widths and wide characters", () => {
  const group = new ActivityGroup(() => {}, (text) => text);
  group.update([{ key: new Text(""), component: thought("读文件"), kind: "thought" }], true);
  for (const width of [2, 8, 20, 80]) {
    for (const line of group.render(width)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
  }
});

test("the adapter fails open on unrecognized Pi versions and document layouts", () => {
  const document = new Container();
  document.children = [new Container(), new Container(), new Container()];
  assert.equal(findChat({ children: [document] }, "1.4.0"), document.children[2]);
  assert.equal(findChat({ children: [document] }, "1.5.0"), undefined);
  assert.equal(findChat({ children: [] }, "1.4.0"), undefined);
  document.addChild(new Container());
  assert.equal(findChat({ children: [document] }, "1.4.0"), undefined);
});

test("latest-group toggle changes only the most recent group without expanding tool output", () => {
  const older = tool();
  const recent = new ToolExecutionComponent("read", "recent", { path: "latest.ts" }, {}, createReadToolDefinition("/tmp"), ui, "/tmp");
  recent.updateResult({ content: [{ type: "text", text: "HIDDEN FILE CONTENT" }], isError: false });
  const { chat, view, redraws } = setup([older, new Text("BETWEEN", 0, 0), recent,
    assistant([{ type: "text", text: "AFTER" }])]);
  // No preceding render: the shortcut must use current transcript membership.
  view.toggleLatestGroup();
  let output = lines(chat).join("\n");
  assert.match(output, /\+ 1 command[\s\S]*BETWEEN[\s\S]*− 1 read/);
  assert.match(output, /latest\.ts/);
  assert.doesNotMatch(output, /HIDDEN FILE CONTENT|FILE CONTENT/);
  assert.equal((recent as unknown as { expanded: boolean }).expanded, false);
  assert.equal((older as unknown as { expanded: boolean }).expanded, false);
  view.toggleLatestGroup();
  output = lines(chat).join("\n");
  assert.doesNotMatch(output, /latest\.ts|− collapse/);
  assert.match(output, /\+ 1 read/);
  assert.equal(redraws(), 2);
});

test("latest-block toggle peeks at a PR notification without expanding older activity or nested outputs", () => {
  const older = tool();
  const notice = notification();
  const { chat, view, redraws } = setup([older, notice, assistant([{ type: "text", text: "AFTER" }])]);
  view.toggleLatestGroup(); // no preceding render
  assert.match(lines(chat).join("\n"), /\+ 1 command[\s\S]*▾ pr-watch-notification[\s\S]*PR DETAILS[\s\S]*AFTER/);
  assert.doesNotMatch(lines(chat).join("\n"), /FILE CONTENT/);
  assert.equal((older as unknown as { expanded: boolean }).expanded, false);
  chat.invalidate();
  assert.match(lines(chat).join("\n"), /PR DETAILS/, "invalidation preserves the peek");
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /▸ pr-watch-notification/);
  assert.doesNotMatch(lines(chat).join("\n"), /PR DETAILS/);
  assert.equal(redraws(), 2);
});

test("shortcut peeks auto-collapse across activity and PR notification boundaries", () => {
  const { chat, view } = setup([tool()]);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /− 1 command/);
  chat.addChild(notification("FIRST PR DETAILS"));
  assert.match(lines(chat).join("\n"), /\+ 1 command[\s\S]*▸ pr-watch-notification/);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /FIRST PR DETAILS/);
  chat.addChild(assistant([{ type: "text", text: "PROGRESS" }]));
  assert.match(lines(chat).join("\n"), /FIRST PR DETAILS/, "prose alone does not end the peek");
  chat.addChild(tool("read"));
  assert.doesNotMatch(lines(chat).join("\n"), /FIRST PR DETAILS/);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /− 1 read/);
  chat.addChild(notification("SECOND PR DETAILS"));
  assert.match(lines(chat).join("\n"), /\+ 1 read/);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /SECOND PR DETAILS/);
  chat.addChild(notification("THIRD PR DETAILS"));
  assert.doesNotMatch(lines(chat).join("\n"), /SECOND PR DETAILS/);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /THIRD PR DETAILS/);
});

test("global expansion and explicit collapse take ownership of PR notification peeks", () => {
  const notice = notification();
  const { chat, view, setExpanded } = setup([notice]);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /PR DETAILS/);
  setExpanded(true);
  notice.setExpanded(true); // native Ctrl+O updates all expandable chat children
  chat.addChild(tool()); // even when no render occurs between Ctrl+O and new activity
  assert.match(lines(chat).join("\n"), /PR DETAILS[\s\S]*− 1 command/);

  setExpanded(false);
  notice.setExpanded(false);
  view.resetExpansion(false);
  chat.children = [notice];
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /PR DETAILS/);
  view.resetExpansion(false); // /activity collapse also resets at unchanged global state
  assert.doesNotMatch(lines(chat).join("\n"), /PR DETAILS/);
  view.resetExpansion(true);
  assert.match(lines(chat).join("\n"), /PR DETAILS/);
});

test("other injected message types are not PR shortcut targets", () => {
  const { chat, view } = setup([tool(), notification("OTHER DETAILS", "other-harness")]);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /− 1 command/);
  assert.doesNotMatch(lines(chat).join("\n"), /OTHER DETAILS/);
  const onlyOther = setup([notification("OTHER DETAILS", "other-harness")]);
  onlyOther.view.toggleLatestGroup();
  assert.equal(onlyOther.redraws(), 0);
  const full = setup([notification()]);
  full.view.enabled = false;
  full.view.toggleLatestGroup();
  assert.equal(full.redraws(), 0);
});

test("a shortcut-opened group auto-collapses when a newer group appears", () => {
  const first = tool();
  const { chat, view } = setup([first]);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /− 1 command/);
  chat.addChild(assistant([{ type: "text", text: "PROGRESS" }]));
  assert.match(lines(chat).join("\n"), /− 1 command/, "prose alone does not end the peek");
  chat.addChild(tool("read"));
  let output = lines(chat).join("\n");
  assert.match(output, /\+ 1 command[\s\S]*PROGRESS[\s\S]*\+ 1 read/);
  assert.doesNotMatch(output, /FILE CONTENT|− collapse/);
  view.toggleLatestGroup();
  output = lines(chat).join("\n");
  assert.match(output, /\+ 1 command[\s\S]*− 1 read/);
  view.toggleLatestGroup();
  assert.doesNotMatch(lines(chat).join("\n"), /FILE CONTENT|− collapse/);
  assert.equal((first as unknown as { expanded: boolean }).expanded, false);
});

test("a shortcut peek stays open while more tools join the same group", () => {
  const { chat, view } = setup([thought(), tool()]);
  view.toggleLatestGroup();
  lines(chat);
  chat.addChild(tool("read"));
  chat.invalidate();
  const output = lines(chat).join("\n");
  assert.match(output, /− 1 command, 1 read/);
  assert.match(output, /FILE CONTENT/);
});

test("later reasoning runs retain their shortcut peek when streaming ends or caches invalidate", () => {
  const message = assistant([
    { type: "thinking", thinking: "INITIAL REASONING" },
    { type: "text", text: "PROGRESS" },
    { type: "thinking", thinking: "LATER REASONING" },
    { type: "toolCall", id: "read-run", name: "read", arguments: { path: "file.ts" } },
  ]);
  const content = (message as unknown as { lastMessage: AssistantMessage }).lastMessage;
  message.updateContent(content, true);
  const { chat, view } = setup([message, tool("read")]);
  view.toggleLatestGroup();
  assert.match(lines(chat).join("\n"), /− 1 read/);
  message.updateContent(content, false); // native message_end finalizes this same assistant component
  let output = lines(chat).join("\n");
  assert.match(output, /− 1 read/);
  assert.match(output, /LATER REASONING/);
  assert.doesNotMatch(output, /INITIAL REASONING/);
  chat.invalidate();
  assert.match(lines(chat).join("\n"), /− 1 read/);
  chat.addChild(assistant([{ type: "text", text: "NEW PROGRESS" }]));
  chat.addChild(tool("edit"));
  output = lines(chat).join("\n");
  assert.match(output, /\+ 1 read[\s\S]*NEW PROGRESS[\s\S]*\+ 1 edit/);
  assert.doesNotMatch(output, /LATER REASONING/);
});

test("mouse-opened groups remain independent when a newer group appears", () => {
  for (const openedByShortcutFirst of [false, true]) {
    const { chat, view } = setup([tool()]);
    if (openedByShortcutFirst) {
      view.toggleLatestGroup();
      const output = lines(chat);
      chat.handleMouse(click(1, output.length)); // mouse-close the keyboard peek
    }
    const output = lines(chat);
    chat.handleMouse(click(1, output.length)); // explicitly mouse-open it
    chat.addChild(assistant([{ type: "text", text: "PROGRESS" }]));
    chat.addChild(tool("read"));
    assert.match(lines(chat).join("\n"), /− 1 command[\s\S]*PROGRESS[\s\S]*\+ 1 read/);
  }
});

test("global expansion takes ownership away from a shortcut peek", () => {
  const { chat, view, setExpanded } = setup([tool()]);
  view.toggleLatestGroup();
  lines(chat);
  setExpanded(true);
  lines(chat);
  chat.addChild(assistant([{ type: "text", text: "PROGRESS" }]));
  chat.addChild(tool("read"));
  assert.match(lines(chat).join("\n"), /− 1 command[\s\S]*PROGRESS[\s\S]*− 1 read/);
});

test("latest-group toggle is silent with no groups or in full mode", () => {
  const empty = setup([new Text("USER MESSAGE", 0, 0)]);
  empty.view.toggleLatestGroup();
  assert.deepEqual(lines(empty.chat), ["USER MESSAGE"]);
  assert.equal(empty.redraws(), 0);
  const nothing = setup([]);
  nothing.view.toggleLatestGroup();
  assert.deepEqual(lines(nothing.chat), []);
  assert.equal(nothing.redraws(), 0);
  const full = setup([tool()]);
  full.view.enabled = false;
  full.view.toggleLatestGroup();
  assert.equal(full.redraws(), 0);
});

test("tool expansion notices and their padding disappear without hiding other statuses or quoted prose", () => {
  const notice = new ThemedText(() => "Tool output: expanded", 1, 0);
  const status = new ThemedText(() => "Reloaded settings", 1, 0);
  const children = [tool(), new Spacer(1), notice, tool("read"), new Spacer(1), status,
    assistant([{ type: "text", text: "Tool output: collapsed" }])];
  const { chat } = setup(children);
  const output = lines(chat).join("\n");
  assert.match(output, /\+ 1 command, 1 read/);
  assert.doesNotMatch(output, /Tool output: expanded/);
  assert.match(output, /Reloaded settings/);
  assert.match(output, /Tool output: collapsed/);
  assert.deepEqual(chat.children, children, "native source entries are not removed or rewritten");
});

test("a reused current status can show non-tool notices after hiding tool expansion notices", () => {
  let status = "Tool output: expanded";
  const notice = new ThemedText(() => status, 1, 0);
  const children = [new Spacer(1), notice];
  const { chat } = setup(children);
  assert.deepEqual(lines(chat), []);
  status = "Thinking blocks: visible";
  notice.invalidate(); // native showStatus reuses and invalidates its final component
  assert.match(lines(chat).join("\n"), /Thinking blocks: visible/);
  status = "Tool output: collapsed";
  notice.invalidate();
  assert.deepEqual(lines(chat), []);
  status = "Model: another-model";
  notice.invalidate();
  assert.match(lines(chat).join("\n"), /Model: another-model/);
  assert.deepEqual(chat.children, children);
});

test("previously rendered historical expansion notices stay hidden when native latest-status state changes", () => {
  let status = "Tool output: expanded";
  const notice = new ThemedText(() => status, 1, 0);
  notice.render(80); // Existing native transcript entry, before our view sees it.
  status = "Reloaded settings";
  const { chat } = setup([new Spacer(1), notice, new Text("AFTER", 0, 0)]);
  assert.deepEqual(lines(chat), ["AFTER"]);
  notice.invalidate();
  assert.deepEqual(lines(chat), ["AFTER"]);
});

test("suppressed historical status notices do not reappear after other statuses", () => {
  let status = "Tool output: collapsed";
  const notice = new ThemedText(() => status, 1, 0);
  const { chat } = setup([new Spacer(1), notice]);
  assert.deepEqual(lines(chat), []);
  chat.addChild(new Text("AFTER", 0, 0));
  status = "Another status";
  chat.invalidate();
  assert.deepEqual(lines(chat), ["AFTER"]);
});

test("Ctrl+Shift+O is registered and toggles the latest group without global expansion or notifications", async () => {
  const handlers = new Map<string, Function>();
  let shortcut: { handler: Function } | undefined;
  compactActivity({ on: (name: string, handler: Function) => handlers.set(name, handler), registerCommand() {},
    registerShortcut: (key: string, options: { handler: Function }) => {
      assert.equal(key, "ctrl+shift+o"); shortcut = options;
    },
  } as never);
  const chat = new Container(); chat.addChild(tool());
  const document = new Container(); document.children = [new Container(), new Container(), chat];
  const ctx = { mode: "tui", ui: {
    custom: async (factory: Function) => factory({ children: [document], requestRender() {} }, {}, {}, () => {}),
    theme: { fg: (_color: string, text: string) => text },
    getToolsExpanded: () => false,
    setToolsExpanded: () => assert.fail("local toggle must not change global expansion"),
    notify: () => assert.fail("shortcut must be silent"),
  } };
  await handlers.get("session_start")!({}, ctx);
  await shortcut!.handler(ctx);
  assert.match(lines(chat).join("\n"), /− 1 command/);
  await shortcut!.handler(ctx);
  assert.deepEqual(lines(chat), ["", " + 1 command"]);
  handlers.get("session_shutdown")!({}, ctx);
});

test("non-TUI sessions never install UI or change messages", async () => {
  const handlers = new Map<string, Function>();
  const pi = { on: (name: string, handler: Function) => handlers.set(name, handler), registerCommand() {}, registerShortcut() {} };
  compactActivity(pi as never);
  for (const mode of ["rpc", "json", "print"]) {
    await handlers.get("session_start")!({}, { mode, ui: { custom() { assert.fail("no custom UI outside TUI"); } } });
  }
  assert.deepEqual([...handlers.keys()], ["session_start", "session_shutdown"]);
});
