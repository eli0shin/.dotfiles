// Which agent watches a PR: Ctrl+G, F, then type a PR number, a repo, or both
// (`ffs 2032`, `tool#7`; see match.js). Rows look like the Agents list's
// (eli-agents) without the status, jump label and time: an orchestrator shows
// its "N workers" chip, so a PR it shares with a worker reads as either. The
// chips are the PRs that matched. ↑/↓ (or ctrl-p/ctrl-n) to move, Enter or a
// click to focus that agent, Esc to close. Agents on machines the Agents list
// hides (Ctrl+G, /) stay out here too.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, spaces, shared, run, theme, props, closeOverlay } from "herdr";
import { tabNames } from "./names.js";
import { piWatch, orchestrations } from "./watch.js";
import { SPACE_COLORS_KEY, spaceTextColor } from "./colors.js";
import { watchedPrs, rankAgents } from "./match.js";

const ROWS = 9;
const CHIPS = 3;
// Keep in sync with eli-agents/main.js: the list's published order, the
// machines it hides, an agent's machine, and its row type.
const ORDER_KEY = "dotfiles.agents.order";
const HIDDEN_MACHINES_KEY = "dotfiles.agents.hidden-machines";
const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : "");
const LIVE_TITLE = "#F2F2F2";
const CHIP_BG = "#ffffff0d";

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// As eli-agents names a row: the tab's name, or the agent's own title when
// nobody named the tab.
function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}
function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class PrFinder extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = 0;
    this.top = 0;
    this.input = InputState.new({ placeholder: "PR number or repo…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.results()[this.at]));
    this.input.focus();
    // The overlay can take focus back while it opens (as the shipped picker works around).
    cx.timer.after(600, () => this.input.focus());
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(row) {
    this.close();
    if (row) run("agent.focus", { terminal: row.agent.address });
  }

  // Agents watching a PR, in the Agents list's order, each with its PRs.
  rows() {
    const hidden = new Set(shared(HIDDEN_MACHINES_KEY) ?? []);
    const list = agents().filter((a) => !hidden.has(machineOf(a)));
    const terminal = new Map(terminals().map((t) => [t.address, t]));
    const watches = new Map(list.map((a) => [a.address, piWatch(terminal.get(a.address))]));
    const { workers } = orchestrations(list, (a) => watches.get(a.address));
    const order = shared(ORDER_KEY)?.addresses ?? [];
    const rank = (a) => { const i = order.indexOf(a.address); return i === -1 ? Infinity : i; };
    return [...list]
      .sort((x, y) => rank(x) - rank(y))
      .map((a) => ({
        agent: a,
        watch: watches.get(a.address),
        workers: workers.get(a.address)?.length ?? 0,
        prs: watchedPrs(watches.get(a.address), (a.space_name ?? "").split("@")[0].replace(/^\./, "")),
      }))
      .filter((row) => row.prs.length);
  }

  results() {
    return rankAgents(this.filter, this.rows());
  }

  render() {
    const t = theme();
    const list = this.results();
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    this.top = Math.max(0, Math.min(this.top, this.at, list.length - ROWS));
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
    const below = Math.max(0, list.length - this.top - ROWS);
    const note = (text) => div().px(14).h(22).flex_none().text_size(11).text_color(t.dim).child(text);

    // Row titles, as the Agents list names them.
    const allPanes = panes();
    const leads = leadPanes(allPanes);
    const labels = new Map(spaces().flatMap((s) => {
      const names = tabNames(s.tabs, allPanes);
      return s.tabs.map((tab) => [tab.id, tab.named || names.get(tab.id) !== tab.name ? names.get(tab.id) : title(tab, leads.get(tab.id))]);
    }));
    const colors = shared(SPACE_COLORS_KEY) ?? {};
    const quiet = t.dim + "D9";
    const chip = (id) => h_flex().id(id).flex_none().h(17).px(5).gap(4).items_center().rounded(4).bg(CHIP_BG).text_size(11.5);

    const row = (r, i) => {
      const a = r.agent;
      const on = i === this.at;
      const live = a.status !== "idle";
      const tone = live ? t[a.status] ?? t.dim : null;
      const name = labels.get(a.tab) ?? (a.title || a.program?.name || a.address);
      const machine = machineOf(a);
      const shown = r.matched.slice(0, CHIPS);
      return h_flex()
        .id(`pf-${a.address}`)
        .relative()
        .mx(4)
        .px(8)
        .py(4)
        .flex_none()
        .rounded(8)
        .border_1()
        .border_color(on ? t.working + "73" : "#00000000")
        .when(on, (el) => el.bg(t.working + "12"))
        .cursor_pointer()
        .hover((el) => el.bg(t.hover))
        .on_click(() => this.go(r))
        .when(Boolean(tone), (el) => el.child(div().absolute().left(0).top(8).bottom(8).w(2.5).rounded(2).bg(tone)))
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().h(22).gap(9).items_center()
            .when(Boolean(icon(a.program, 16, t.foreground)), (el) => el.child(icon(a.program, 16, t.foreground)))
            .child(div().flex_1().min_w(0).truncate().text_size(14.5).text_color(live || a.focused ? LIVE_TITLE : t.foreground + "E6").child(name)))
          .child(h_flex().h(19).gap(6).items_center().text_size(12.5).text_color(t.dim)
            .child(h_flex().flex_1().min_w(0).items_center()
              .child(div().min_w(0).truncate().text_color(spaceTextColor(colors[a.space]) ?? t.dim).child(a.space_name ?? ""))
              .when(Boolean(r.workers && r.watch?.ticket), (el) => el.child(div().flex_none().child(` · ${r.watch.ticket}`))))
            .when(r.workers > 0, (el) => el.child(chip(`pf-w-${a.address}`).text_color(t.foreground + "C0").child(`${r.workers} worker${r.workers === 1 ? "" : "s"}`)))
            .children(shown.map((pr, j) => chip(`pf-pr-${a.address}-${j}`).text_color(t.foreground + "B3")
              .when(Boolean(r.watch?.paused), (el) => el.italic())
              .child(svg("mods/eli-agents/git-pull-request.svg").size(11).flex_none())
              .child(pr.label)))
            .when(r.matched.length > CHIPS, (el) => el.child(div().flex_none().text_color(t.dim).child(`+${r.matched.length - CHIPS}`)))
            .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(11.5).text_color(quiet).child(machine)))));
    };

    return v_flex()
      .id("pr-finder")
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
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Find a PR"))
        .child(div().text_size(11).text_color(t.dim).child("↑/↓ · Enter · Esc")))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().gap(2)
        .children(list.slice(this.top, this.top + ROWS).map((r, j) => row(r, this.top + j)))
        .when(below > 0, (el) => el.child(note(`↓ ${below} more`)))
        .when(!list.length, (el) => el.child(note(this.filter.trim() ? "No agent watches a PR like that" : "No agent is watching a PR"))));
  }
}
