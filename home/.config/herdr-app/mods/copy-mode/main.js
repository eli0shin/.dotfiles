// Keyboard copy mode, like the legacy Herdr TUI's prefix+[ (Ctrl+G [ here):
// move a cursor through the focused terminal's screen and history, select with
// v (characters) or V (lines), y or Enter copies and leaves. Esc leaves visual
// selection, then copy mode; q leaves at once. The popup holds the keyboard;
// the selection is drawn in the terminal itself.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { focused, terminals, panes, run, theme, props, closeOverlay, notify, checking, nextCommand } from "herdr";
import { createCopyMode, keyName } from "./copy.js";

const HINTS = { normal: "hjkl · v / V select · q quit", char: "y copy · Esc back", line: "y copy · Esc back" };

export default class CopyMode extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The overlay can take focus back while it opens (as space-picker works around).
    cx.timer.after(600, () => this.handle.focus());
    this.done = false;
    // Keys that arrive while ^ or $ measures a row wait their turn.
    this.measuring = false;
    this.waiting = [];
    this.terminal = focused()?.terminal ?? null;
    if (checking()) return;
    if (!this.terminal) {
      notify({ title: "Copy mode", body: "No terminal has the focus.", level: "warning" });
      this.leave(false);
      return;
    }
    this.copy = createCopyMode({ terminal: this.terminal, run, geometry: () => this.geometry() });
    // Esc would close the popup before on_key_down sees it; keys.json's
    // mod:copy-mode section sends it here instead, so it can leave visual mode first.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "escape") this.press("escape", cx);
      }
    });
    // Start at the program's cursor: select it, then read where that landed.
    const before = JSON.stringify(this.selection());
    run("terminal.select", { terminal: this.terminal, at: "cursor" });
    cx.spawn(async (cx) => {
      for (let i = 0; i < 50; i++) {
        const s = this.selection();
        if (s && JSON.stringify(s) !== before) break;
        await cx.sleep(10);
      }
      const s = this.selection();
      const g = this.geometry();
      const cursor = s?.end ?? { row: g.total - 1, col: 0 };
      if (!s) run("terminal.select", { terminal: this.terminal, at: cursor });
      this.copy.start(cursor);
      cx.notify();
    });
  }

  term() {
    return terminals().find((t) => t.address === this.terminal);
  }

  selection() {
    return this.term()?.selection ?? null;
  }

  geometry() {
    const t = this.term();
    const scroll = panes().find((p) => p.terminal === this.terminal)?.scroll ?? null;
    const rows = t?.rows ?? 1;
    return {
      cols: t?.cols ?? 1,
      total: scroll?.total ?? rows,
      offset: scroll?.offset ?? 0,
      len: scroll?.len ?? rows,
      // On the alternate screen (vim, less, fullscreen agents) there is no history to scroll.
      scrolls: Boolean(scroll),
    };
  }

  // Puts the terminal back as it was: no selection, the view at the bottom.
  restore() {
    if (!this.terminal) return;
    run("terminal.clear_selection", { terminal: this.terminal });
    if (this.geometry().scrolls) run("terminal.scroll", { terminal: this.terminal, to: "bottom" });
  }

  leave(copy) {
    if (this.done) return;
    this.done = true;
    // terminal.copy copies the focused terminal's selection: the one this mode ran on.
    if (copy) run("terminal.copy");
    this.restore();
    closeOverlay(props().overlay);
  }

  // Returns whether the key was copy mode's.
  press(name, cx) {
    if (this.measuring) {
      this.waiting.push(name);
      return true;
    }
    const result = this.copy?.key(name) ?? (name === "escape" ? { exit: true, copy: false } : null);
    if (!result) return false;
    if (result.exit) this.leave(result.copy);
    else if (result.measure) this.measure(result.measure, cx);
    else cx.notify();
    return true;
  }

  // Selects the row as a line, reads where its text starts and ends, and hands
  // that back to copy mode, which draws its own selection again.
  measure(request, cx) {
    this.measuring = true;
    const before = JSON.stringify(this.selection());
    run("terminal.select", { terminal: this.terminal, at: { row: request.row, col: 0 }, mode: "line" });
    cx.spawn(async (cx) => {
      for (let i = 0; i < 15 && JSON.stringify(this.selection()) === before; i++) await cx.sleep(10);
      if (this.done) return;
      this.copy.measured(request, this.selection());
      this.measuring = false;
      cx.notify();
      while (!this.measuring && this.waiting.length && !this.done) this.press(this.waiting.shift(), cx);
    });
  }

  // A click beside the popup closes it without a key.
  close() {
    if (this.done) return;
    this.done = true;
    this.restore();
  }

  render() {
    const t = theme();
    const state = this.copy?.state();
    const mode = state?.mode ?? "normal";
    const where = state?.pos && this.terminal ? `${state.pos.row + 1}/${this.geometry().total}` : "";
    return h_flex()
      .id("copy-mode")
      .track_focus(this.handle)
      .w_full()
      .h(32)
      .px(12)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .text_size(12)
      .on_key_down((e, cx) => {
        const name = keyName(e);
        if (name && this.press(name, cx)) cx.stop_propagation();
      })
      .child(div().font_semibold().text_color(mode === "normal" ? t.accent : t.working).child(state?.label ?? "COPY"))
      .child(div().flex_1().truncate().text_color(t.dim).child(HINTS[mode]))
      .child(div().text_color(t.muted).child(where));
  }
}
