// Ctrl+; then a label, focuses that row of the Agents list (eli-agents): 1–9
// and 0 as the rows are labelled, then letters (see jump.js), so it reaches
// past the tenth agent in two keys. The popup holds the keyboard; the sidebar shows the
// labels while it is open, shown for the jump if it was hidden. Esc, Ctrl+; or a
// click elsewhere leaves without a jump.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, shared, setShared, run, theme, props, closeOverlay, layout, checking } from "herdr";
import { JUMP_KEY, jumpLabels } from "./jump.js";

// Keep in sync with eli-agents/main.js: the rows' order, as the sidebar shows them.
const ORDER_KEY = "dotfiles.agents.order";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class AgentJump extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The overlay can take focus back while it opens (as space-picker works around).
    cx.timer.after(600, () => this.handle.focus());
    this.typed = "";
    this.done = false;
    if (checking()) return;
    this.revealed = Boolean(find(layout(), "sidebar")?.hidden);
    if (this.revealed) run("layout.show", { id: "sidebar" });
    setShared(JUMP_KEY, { at: Date.now() });
    // Kept fresh while open: eli-agents drops labels a minute after the last stamp.
    cx.timer.every(20000, () => {
      if (!this.done) setShared(JUMP_KEY, { at: Date.now() });
    });
  }

  // The sidebar's published rows, minus any agent gone since it drew them.
  targets() {
    const live = new Set(agents().map((a) => a.address));
    const rows = (shared(ORDER_KEY)?.addresses ?? []).filter((address) => live.has(address));
    const labels = jumpLabels(rows.length);
    return rows.map((address, i) => ({ address, label: labels[i] }));
  }

  // A full label jumps; the first of two letters waits for the second. Other keys are ignored.
  press(key, cx) {
    const typed = this.typed + key;
    const targets = this.targets();
    const hit = targets.find((t) => t.label === typed);
    if (hit) return this.leave(hit.address);
    this.typed = targets.some((t) => t.label.startsWith(typed)) ? typed : "";
    cx.notify();
  }

  // Closes first, as the pickers do, so the popup can't take focus back from the agent.
  leave(address) {
    this.target = address;
    closeOverlay(props().overlay);
    this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    if (checking()) return;
    setShared(JUMP_KEY, null);
    if (this.revealed) run("layout.hide", { id: "sidebar" });
    if (this.target) run("agent.focus", { terminal: this.target });
  }

  // Esc, Ctrl+; again or a click beside the popup closes it without a jump.
  close() {
    this.finish();
  }

  render() {
    const t = theme();
    const labels = jumpLabels(this.targets().length);
    const count = labels.length;
    // Letters go a, s, d, f…, so a range like a–d would mislead: name a few, else say what they are.
    const letters = labels.slice(10);
    const digits = count <= 9 ? `1–${count}` : "1–9 · 0";
    const range = !letters.length ? digits : `${digits} · ${letters.length <= 6 ? letters.join(" ") : letters[0].length > 1 ? "two letters" : "letters"}`;
    return h_flex()
      .id("agent-jump")
      .track_focus(this.handle)
      .w_full()
      .h(32)
      .px(12)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .text_size(12)
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (m.platform || m.control || m.alt) return;
        const key = (e.key_char || e.key || "").toLowerCase();
        if (key.length !== 1) return;
        cx.stop_propagation();
        this.press(key, cx);
      })
      .child(div().font_semibold().text_color(t.working).child("JUMP"))
      .child(div().flex_1().truncate().text_color(t.dim).child(count ? `${range} · Esc` : "No agents to jump to · Esc"))
      .when(Boolean(this.typed), (el) => el.child(div().font_semibold().text_color(t.foreground).child(this.typed)));
  }
}
