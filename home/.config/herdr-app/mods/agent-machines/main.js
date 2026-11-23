// Which machines' agents the Agents list (eli-agents) shows. Ctrl+G, / or the
// list's machine button. ↑/↓ (or j/k) to move, Space to show or hide the
// machine under the cursor, Enter to show only it, Esc or q to close. "All
// machines" shows every one. The choice persists in shared state.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, machines, shared, setShared, theme, props, closeOverlay } from "herdr";
import { machineRows, toggleMachine, onlyMachine } from "./filter.js";

// Keep in sync with eli-agents/main.js and navigator-status/agent-order.js.
const HIDDEN_MACHINES_KEY = "dotfiles.agents.hidden-machines";
const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : "");

export default class AgentMachines extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The overlay can take focus back while it opens (as the shipped picker works around).
    cx.timer.after(600, () => this.handle.focus());
  }

  close() {
    closeOverlay(props().overlay);
  }

  hidden() {
    return shared(HIDDEN_MACHINES_KEY) ?? [];
  }

  // Row 0 is "All machines"; the rest are machines.
  apply(rows, i, how) {
    const hidden = this.hidden();
    const next = i === 0 ? [] : how === "only" ? onlyMachine(rows, rows[i].key) : toggleMachine(hidden, rows[i].key);
    setShared(HIDDEN_MACHINES_KEY, next.length ? next : null);
  }

  render() {
    const t = theme();
    const hidden = this.hidden();
    const rows = [{ key: null, label: "All machines" }, ...machineRows(machines(), agents().map(machineOf), hidden)];
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));

    const check = (on) => div().size(16).flex_none().rounded(4).border(1.5)
      .border_color(on ? t.working : t.dim)
      .when(on, (el) => el.bg(t.working + "33"))
      .flex().items_center().justify_center()
      .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(12).text_color(t.foreground)));

    const row = (r, i) => {
      const on = i === 0 ? hidden.length === 0 : !r.hidden;
      return h_flex()
        .id(`am-${i}`)
        .mx(4)
        .px(10)
        .h(32)
        .flex_none()
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => {
          this.at = i;
          this.apply(rows, i, "toggle");
          cx.notify();
        })
        .child(check(on))
        .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(r.label))
        .when(i > 0 && r.offline, (el) => el.child(div().text_size(11).text_color(t.dim).child("offline")))
        .when(i > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(`${r.count} agent${r.count === 1 ? "" : "s"}`)))
        .when(i === this.at && i > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child("⏎ only")));
    };

    return v_flex()
      .id("agent-machines")
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
        if (k === "escape" || k === "q") return this.close();
        if (k === "enter") {
          this.apply(rows, this.at, "only");
          return this.close();
        }
        if (k === "space") this.apply(rows, this.at, "toggle");
        else if (k === "j" || k === "down") this.at = (this.at + 1) % rows.length;
        else if (k === "k" || k === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Agents from"))
        .child(div().text_size(11).text_color(t.dim).child("↑/↓ · Space · Enter only · Esc")))
      .child(v_flex().children(rows.map(row)));
  }
}
