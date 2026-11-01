import assert from "node:assert/strict";
import test from "node:test";
import { ToolExecutionComponent, createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, initTheme } from "@earendil-works/pi-coding-agent";
import {
  Container, Text, getCapabilities, setCapabilities, stripTerminalSequences,
  type Component, type TUI, type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { installActivityView } from "../compact-activity/index.ts";

initTheme("dark");
const ui = { requestRender() {} } as TUI;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const background = /\x1b\[(?:48[;:]|4[0-7]m|10[0-7]m)/;
function tool(name: string, images = 0) {
  const component = new ToolExecutionComponent(name, name, { path: `/tmp/${name}.png` }, {}, {
    renderCall: () => new Text(`read /tmp/${name}.png`, 0, 0),
    renderResult: () => new Text("", 0, 0),
  }, ui, "/tmp");
  component.updateResult({ content: Array.from({ length: images }, () => ({ type: "image", data: png, mimeType: "image/png" })), isError: false });
  return component;
}
function setup(children: Component[], styleError: (text: string) => string = (text) => text) {
  const chat = new Container();
  chat.children = children;
  let expanded = false;
  const installed = installActivityView(chat, () => {}, (text) => text, () => expanded, styleError);
  return { chat, ...installed, expand: (value: boolean) => { expanded = value; } };
}
function withImages(protocol: "kitty" | "iterm2", run: () => void) {
  const original = getCapabilities();
  setCapabilities({ ...original, images: protocol });
  try { run(); } finally { setCapabilities(original); }
}

for (const protocol of ["kitty", "iterm2"] as const) {
  test(`${protocol}: collapsed images stay visible without paths; expansion shows each only once in order`, () => {
    withImages(protocol, () => {
      const first = tool("FIRST", 1);
      const second = tool("SECOND", 2);
      const { chat, expand } = setup([first, tool("TEXT_ONLY"), second]);
      const images = [first, second].flatMap((source) =>
        (source as unknown as { imageComponents: Component[] }).imageComponents);
      const sequences = images.map((image) => image.render(80).find((line) => line.includes("\x1b"))!);
      assert.equal(sequences.length, 3);
      const checkImages = (output: string) => {
        for (const sequence of new Set(sequences)) {
          const expected = sequences.filter((value) => value === sequence).length;
          assert.equal(output.split(sequence).length - 1, expected, "each original image appears exactly once");
        }
      };
      let output = chat.render(80).join("\n");
      assert.match(output, /\+ 3 commands/);
      assert.doesNotMatch(output, /FIRST\.png|SECOND\.png|TEXT_ONLY\.png/);
      assert.doesNotMatch(output, background);
      checkImages(output);
      assert.ok(output.indexOf(sequences[0]) < output.lastIndexOf(sequences[2]));
      expand(true);
      output = chat.render(80).join("\n");
      assert.doesNotMatch(output, background);
      assert.ok(output.indexOf("FIRST.png") < output.indexOf(sequences[0]));
      assert.ok(output.indexOf(sequences[0]) < output.indexOf("TEXT_ONLY.png"));
      assert.ok(output.indexOf("TEXT_ONLY.png") < output.indexOf("SECOND.png"));
      assert.ok(output.indexOf("SECOND.png") < output.lastIndexOf(sequences[2]));
      checkImages(output);
      const expandedLines = chat.render(80);
      const footer = expandedLines.findIndex((line) => stripTerminalSequences(line).trim() === "− collapse");
      assert.ok(footer > 0);
      chat.handleMouse({ type: "click", button: "left", x: 2, y: footer, screenX: 2, screenY: footer,
        width: 80, height: expandedLines.length } as TuiMouseEvent);
      output = chat.render(80).join("\n");
      assert.doesNotMatch(output, /FIRST\.png|SECOND\.png|TEXT_ONLY\.png|− collapse/);
      checkImages(output);
      expand(false);
      checkImages(chat.render(80).join("\n"));
    });
  });
}

test("image visibility settings and result updates apply to collapsed previews", () => {
  withImages("kitty", () => {
    const source = tool("IMAGE", 1);
    const { chat } = setup([source]);
    assert.match(chat.render(80).join("\n"), /\x1b_G/);
    source.setShowImages(false);
    assert.doesNotMatch(chat.render(80).join("\n"), /\x1b_G/);
    source.setShowImages(true);
    assert.match(chat.render(80).join("\n"), /\x1b_G/);
    source.updateResult({ content: [{ type: "text", text: "no image now" }], isError: false });
    assert.doesNotMatch(chat.render(80).join("\n"), /\x1b_G/);
  });
});

test("unsupported terminals do not get image escapes or invented preview labels", () => {
  const original = getCapabilities();
  setCapabilities({ ...original, images: null });
  try {
    const { chat } = setup([tool("IMAGE", 1)]);
    assert.deepEqual(chat.render(80).map((line) => stripTerminalSequences(line).trimEnd()), ["", " + 1 command"]);
  } finally { setCapabilities(original); }
});

test("expanded tools lose shell backgrounds and vertical padding, but full mode stays unchanged", () => {
  const source = tool("IMAGE");
  const original = source.render(80);
  assert.ok(original.some((line) => background.test(line)), "fixture has Pi's normal tool background");
  const { chat, view, expand } = setup([source]);
  expand(true);
  const compact = chat.render(80);
  assert.ok(compact.length < original.length + 2, "no padded tool box inside expanded group");
  assert.doesNotMatch(compact.join("\n"), background);
  assert.match(compact.join("\n"), /IMAGE\.png/);
  assert.deepEqual(source.render(80), original, "renderers are not mutated");
  view.enabled = false;
  assert.deepEqual(chat.render(80), original);
});

test("edit renderer's own nested box is unframed while preserving the diff", () => {
  const source = new ToolExecutionComponent("edit", "edit-call", { path: "file.ts", edits: [{ oldText: "old", newText: "new" }] },
    {}, createEditToolDefinition("/tmp"), ui, "/tmp");
  source.updateResult({ content: [{ type: "text", text: "Updated file" }], details: { diff: "-1 old\n+1 new", firstChangedLine: 1 }, isError: false });
  const original = source.render(80);
  const { chat, expand } = setup([source]);
  expand(true);
  const output = chat.render(80).join("\n");
  assert.doesNotMatch(output, background);
  assert.match(stripTerminalSequences(output), /old/);
  assert.match(stripTerminalSequences(output), /new/);
  assert.deepEqual(source.render(80), original);
});

test("expanded tool indentation follows Pi's outputPad setting", () => {
  const source = tool("INDENT");
  const { chat, expand } = setup([source]);
  expand(true);
  for (const padding of [0, 1]) {
    source.setOutputPad(padding);
    const line = chat.render(80).map(stripTerminalSequences).find((line) => line.includes("INDENT.png"))!;
    assert.ok(line.startsWith(`${" ".repeat(padding)}read `));
    assert.equal(line.search(/\S/), padding);
  }
});

for (const name of ["read", "bash"] as const) {
  test(`failed ${name} output is red without backgrounds, and its title keeps normal styling`, () => {
    const definition = name === "read" ? createReadToolDefinition("/tmp") : createBashToolDefinition("/tmp");
    const source = new ToolExecutionComponent(name, "failed", name === "read" ? { path: "/tmp/missing.ts" } : { command: "false" },
      {}, definition, ui, "/tmp");
    source.updateResult({ content: [{ type: "text", text: "ENOENT: no such file or directory\n\x1b[32mGREEN_TEXT\x1b[0mRESET_TEXT" }], isError: true });
    const original = source.render(80);
    const { chat, expand } = setup([source], (text) => `\x1b[31m${text}\x1b[39m`);
    expand(true);
    const output = chat.render(80);
    assert.doesNotMatch(output.join("\n"), background);
    assert.match(output.join("\n"), /\x1b\[31mENOENT/);
    assert.match(output.join("\n"), /\x1b\[31mGREEN_TEXT/);
    assert.match(output.join("\n"), /\x1b\[31m[^\x1b]*RESET_TEXT/);
    const title = output.find((line) => stripTerminalSequences(line).includes(name === "read" ? "read " : "$ false"))!;
    assert.ok(title);
    assert.doesNotMatch(title, /\x1b\[31m/);
    assert.deepEqual(source.render(80), original);
  });
}

test("failed custom output stays red across its own foreground colors and resets", () => {
  const source = new ToolExecutionComponent("custom", "colored", {}, {}, {
    renderCall: () => new Text("CUSTOM TITLE", 0, 0),
    renderResult: () => new Text("\x1b[32mGREEN\x1b[0mRESET", 0, 0),
  }, ui, "/tmp");
  source.updateResult({ content: [{ type: "text", text: "failure" }], isError: true });
  const { chat, expand } = setup([source], (text) => `\x1b[31m${text}\x1b[39m`);
  expand(true);
  const output = chat.render(80).join("\n");
  assert.match(output, /\x1b\[32m\x1b\[31mGREEN/);
  assert.match(output, /\x1b\[0m\x1b\[31mRESET/);
});

test("failed fallback tools color only the output, preserving title and argument styling", () => {
  const source = new ToolExecutionComponent("unknown_tool", "failed-fallback", { key: "ARGUMENT_VALUE" }, {}, undefined, ui, "/tmp");
  source.updateResult({ content: [{ type: "text", text: "FALLBACK ERROR" }], isError: true });
  const original = source.render(80);
  const { chat, expand } = setup([source], (text) => `\x1b[31m${text}\x1b[39m`);
  expand(true);
  const output = chat.render(80);
  for (const label of ["unknown_tool", "ARGUMENT_VALUE"]) {
    const line = output.find((line) => line.includes(label))!;
    assert.ok(line);
    assert.doesNotMatch(line, /\x1b\[31m/);
  }
  assert.match(output.join("\n"), /\x1b\[31mFALLBACK ERROR/);
  assert.deepEqual(source.render(80), original);
});

test("unregistered fallback tools are unframed too", () => {
  const source = new ToolExecutionComponent("unknown_tool", "fallback", { key: "value" }, {}, undefined, ui, "/tmp");
  source.updateResult({ content: [{ type: "text", text: "FALLBACK RESULT" }], isError: false });
  const { chat, expand } = setup([source]);
  expand(true);
  const output = chat.render(80).join("\n");
  assert.doesNotMatch(output, background);
  assert.match(output, /unknown_tool/);
  assert.match(output, /FALLBACK RESULT/);
});
