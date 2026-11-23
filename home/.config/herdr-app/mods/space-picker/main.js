// Space switcher, like the legacy Herdr workspace picker: type to fuzzy-find a
// space by name (or branch, folder, machine; see match.js), ↑/↓ (or
// ctrl-p/ctrl-n) to move, Enter to go, Esc to close. Spaces are for their
// terminals (agents have the Agents list), so going to one shows a terminal
// tab when its selected tab is an agent's. Rows keep their space
// number, the Ctrl+1–9 that switches to them. The shipped picker lists tabs
// and agents; this lists spaces only.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, agents, panes, terminals, home, run, theme, props, closeOverlay } from "herdr";
import { rankSpaces, terminalTab } from "./match.js";

// Keep in sync with navigator-status/review-view.js: the review's tab, like
// agents' tabs, isn't one of a space's terminals.
const REVIEW_LABEL = "dotfiles.review";

// Rows shown at once; the window follows the selection, so it never leaves the screen.
const ROWS = 12;
const GLYPH = { blocked: "●", done: "●", working: "◐", idle: "○" };

export default class SpacePicker extends View {
  init(_props, cx) {
    this.at = null;
    this.top = 0;
    this.filter = "";
    this.home = home();
    this.input = InputState.new({ placeholder: "Go to space…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      // Empty again: back on the shown space, as when the picker opened.
      this.at = this.filter.trim() ? 0 : null;
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.rows()[this.at ?? 0]));
    this.input.focus();
    // The overlay can take focus back while it opens (as the shipped picker works around).
    cx.timer.after(600, () => this.input.focus());
  }

  // Matching spaces, best first, each with its number in space order.
  rows() {
    const all = spaces().map((space, i) => ({ ...space, number: i + 1 }));
    return rankSpaces(this.filter, all, this.home);
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(space) {
    this.close();
    if (!space) return;
    run("space.select", { id: space.id });
    const review = new Set(terminals().filter((t) => t.state === "live" && t.labels?.[REVIEW_LABEL]).map((t) => t.address));
    const hidden = new Set([...agents().map((a) => a.tab), ...panes().filter((p) => p.terminal && review.has(p.terminal)).map((p) => p.tab)]);
    const tab = terminalTab(spaces().find((s) => s.id === space.id) ?? space, hidden);
    if (tab && !tab.active) run("tab.select", { id: tab.id });
  }

  render() {
    const t = theme();
    const list = this.rows();
    if (this.at === null) this.at = Math.max(0, list.findIndex((s) => s.active));
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    this.top = Math.max(0, Math.min(this.top, this.at, list.length - ROWS));
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
    const above = this.top;
    const below = Math.max(0, list.length - this.top - ROWS);
    const note = (text) => div().px(14).h(20).flex_none().text_size(11).text_color(t.dim).child(text);

    const row = (s, i) => {
      const on = i === this.at;
      return h_flex()
        .id(`sp-${s.id}`)
        .mx(4)
        .px(10)
        .h(32)
        .flex_none()
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .hover((el) => el.bg(t.hover))
        .on_click(() => this.go(s))
        .child(div().w(14).flex_none().text_color(t.dim).child(s.number <= 9 ? String(s.number) : ""))
        .child(div().w(12).flex_none().text_color(t[s.status] ?? t.dim).child(GLYPH[s.status] ?? "·"))
        .child(div().flex_1().truncate().text_color(t.foreground).when(s.active, (el) => el.font_semibold()).child(s.name))
        .when(Boolean(s.machine), (el) => el.child(div().text_size(11).text_color(t.dim).child(s.machine)))
        .child(div().text_size(11).text_color(t.dim).child(`${s.tabs.length} tab${s.tabs.length === 1 ? "" : "s"}`));
    };

    return v_flex()
      .id("space-picker")
      .w_full()
      .min_h(0)
      .p(14)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        const m = e.modifiers;
        if (k === "escape") return this.close();
        if (!list.length) return;
        if (k === "down" || (m.control && k === "n")) this.at = (this.at + 1) % list.length;
        else if (k === "up" || (m.control && k === "p")) this.at = (this.at + list.length - 1) % list.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Spaces")).child(div().text_size(11).text_color(t.dim).child("↑/↓ · Enter · Esc")))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex()
        .when(above > 0, (el) => el.child(note(`↑ ${above} more`)))
        .children(list.slice(this.top, this.top + ROWS).map((s, j) => row(s, this.top + j)))
        .when(below > 0, (el) => el.child(note(`↓ ${below} more`)))
        .when(!list.length, (el) => el.child(note("No space matches"))));
  }
}
