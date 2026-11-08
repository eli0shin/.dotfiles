// Keyboard-only space switcher, like the legacy Herdr workspace picker:
// j/k or ↑/↓ to move, Enter to go, 1–9 to go straight to that space, Esc or q
// to close. The shipped picker lists tabs and agents; this lists spaces only.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, theme, props, closeOverlay } from "herdr";

// Rows shown at once; the window follows the selection, so it never leaves the screen.
const ROWS = 12;
const GLYPH = { blocked: "●", done: "●", working: "◐", idle: "○" };

export default class SpacePicker extends View {
  init(_props, cx) {
    this.at = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.top = 0;
    // The overlay can take focus back while it opens (as the shipped picker works around).
    cx.timer.after(600, () => this.handle.focus());
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(space) {
    this.close();
    if (space) run("space.select", { id: space.id });
  }

  render() {
    const t = theme();
    const list = spaces();
    if (this.at === null) this.at = Math.max(0, list.findIndex((s) => s.active));
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    this.top = Math.max(0, Math.min(this.top, this.at, list.length - ROWS));
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
    const above = this.top;
    const below = Math.max(0, list.length - this.top - ROWS);
    const more = (n, dir) => div().px(14).h(20).flex_none().text_size(11).text_color(t.dim).child(`${dir} ${n} more`);

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
        .child(div().w(14).flex_none().text_color(t.dim).child(i < 9 ? String(i + 1) : ""))
        .child(div().w(12).flex_none().text_color(t[s.status] ?? t.dim).child(GLYPH[s.status] ?? "·"))
        .child(div().flex_1().truncate().text_color(t.foreground).when(s.active, (el) => el.font_semibold()).child(s.name))
        .when(Boolean(s.machine), (el) => el.child(div().text_size(11).text_color(t.dim).child(s.machine)))
        .child(div().text_size(11).text_color(t.dim).child(`${s.tabs.length} tab${s.tabs.length === 1 ? "" : "s"}`));
    };

    return v_flex()
      .id("space-picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(14)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const m = e.modifiers;
        if (m.control || m.alt || m.platform) return;
        const k = e.key;
        if (/^[1-9]$/.test(k) && !m.shift) return this.go(list[Number(k) - 1]);
        if (k === "escape" || k === "q") return this.close();
        if (k === "enter") return this.go(list[this.at]);
        if (!list.length) return;
        if (k === "j" || k === "down") this.at = (this.at + 1) % list.length;
        else if (k === "k" || k === "up") this.at = (this.at + list.length - 1) % list.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Spaces")).child(div().text_size(11).text_color(t.dim).child("j/k · Enter · 1–9 · Esc")))
      .child(v_flex()
        .when(above > 0, (el) => el.child(more(above, "↑")))
        .children(list.slice(this.top, this.top + ROWS).map((s, j) => row(s, this.top + j)))
        .when(below > 0, (el) => el.child(more(below, "↓"))));
  }
}
