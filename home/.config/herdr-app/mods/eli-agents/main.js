// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left. Pi workers nest under their
// orchestrator, and each Pi row lists the PRs it watches (see watch.js).
// Personal clone of the shipped `agents` mod: each row ends with its label
// (1–9, 0, then letters; see jump.js), and the order is published for
// navigator-status's Ctrl+G, Shift+1–0 and agent-jump's Ctrl+;.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, closeOverlay, props, window, layout } from "herdr";
import { tabNames } from "./names.js";
import { piWatch, watchText, orchestrations, edgeStatus } from "./watch.js";
import { JUMP_KEY, jumpLabels, jumping } from "./jump.js";
import { SPACE_COLORS_KEY, assignSpaceColors, spaceTextColor } from "./colors.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
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
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
// Keep in sync with navigator-status/agent-order.js: the published order is
// used only while the agents, their statuses, pins, focus and sort still match.
const ORDER_KEY = "dotfiles.agents.order";
const orderInputs = (list, sort) => [sort ?? "", list.find((a) => a.focused)?.address ?? "", ...list.map((a) => `${a.address}:${a.status}:${a.pinned ? 1 : 0}`)].join("\n");
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
// Keep in sync with agent-machines/main.js and navigator-status/agent-order.js:
// the machines whose agents the list leaves out ("" is this computer), set by
// the agent-machines popup (Ctrl+G, /), and the machine an agent runs on.
const HIDDEN_MACHINES_KEY = "dotfiles.agents.hidden-machines";
const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : "");
// Row type, tuned for the Arctic theme: live titles a touch under white, idle
// ones a step under the theme's text, and the quiet bits (machine, number) under t.dim.
const LIVE_TITLE = "#F2F2F2";
const CHIP_BG = "#ffffff0d";

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  // lead: under a nested Pi worker, whether its orchestrator's tree line goes on past it.
  subRow(t, s, shown, compact, lead = null) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(lead ? 8 : 39)
      .when(Boolean(lead), (el) => el.child(div().w(9).ml(8).mr(35).flex_none().self_stretch()
        .when(lead === "│", (el) => el.border_l(1.5).border_color(t.dim))))
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const everyone = agents();
    // Agents on machines hidden with the agent-machines popup leave the list,
    // its numbers and agent-jump; they're still tracked, so their times hold.
    const hiddenMachines = new Set(shared(HIDDEN_MACHINES_KEY) ?? []);
    let list = everyone.filter((a) => !hiddenMachines.has(machineOf(a)));
    const visible = list;
    this.listed = new Map(everyone.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(everyone, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const terminal = new Map(all.map((t) => [t.address, t]));
    const watches = new Map(list.map((a) => [a.address, piWatch(terminal.get(a.address))]));
    const watchOf = (a) => watches.get(a.address);
    // Workers sit under their orchestrator, so only it is sorted and grouped.
    const { workers, nested } = orchestrations(list, watchOf);
    const workersOf = (a) => workers.get(a.address) ?? [];
    const kidsRank = (a) => this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0);
    // A worker moves its orchestrator like a sub-agent: needing you or working
    // lifts it, but a done worker reports to the orchestrator, not to you.
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...kidsRank(a), ...workersOf(a).map((w) => Math.max(RANK[kidStatus(w, this.listed)] ?? 0, ...kidsRank(w))))]));
    const rankOf = (a) => urgency.get(a.address);
    list = list.filter((a) => !nested.has(a.address));
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    // An orchestrator opens only while it or one of its workers is focused; other
    // rows fold by hand. The rail shows everything. Agent next/previous keeps
    // closed workers in place; the published numbers follow the rows shown.
    const open = (a) => collapsed || (workersOf(a).length ? a.focused || workersOf(a).some((w) => w.focused) : !this.folded.has(a.address));
    const shownWorkers = (a) => (open(a) ? workersOf(a) : []);
    const order = list.flatMap((a) => [a, ...shownWorkers(a)]);
    setAgentOrder(list.flatMap((a) => [a, ...workersOf(a)]).map((a) => a.address));
    const published = { inputs: orderInputs(visible, shared("agents.sort")), addresses: order.map((a) => a.address) };
    const previous = shared(ORDER_KEY);
    if (previous?.inputs !== published.inputs || previous?.addresses?.join("\n") !== published.addresses.join("\n")) setShared(ORDER_KEY, published);
    // Every row shows its jump label; brighter while agent-jump runs (Ctrl+;).
    const jumpOn = jumping(shared(JUMP_KEY), now);
    const labelsByRow = jumpLabels(order.length);
    const jumpLabel = new Map(order.map((a, i) => [a.address, labelsByRow[i]]));
    const mark = (a) => jumpLabel.get(a.address) ?? "";
    const number = (a) => div().w(labelsByRow.at(-1)?.length > 1 ? 18 : 11).flex_none().text_right().text_size(12)
      .when(jumpOn, (el) => el.font_semibold().text_color(t.working)).when(!jumpOn, (el) => el.text_color(t.dim + "B3")).child(mark(a));
    // Each space's name in its color (as the space tiles have it).
    const colors = assignSpaceColors(spaces(), shared(SPACE_COLORS_KEY));
    if (colors.changed) setShared(SPACE_COLORS_KEY, colors.kept);
    const spaceColor = (a) => spaceTextColor(colors.kept[a.space]) ?? t.dim;

    const withKids = (a) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const ws = workersOf(a);
      const wsubs = new Map(ws.map((w) => [w.address, collapsed ? [] : this.tree(all, w.address)]));
      const r = row(a, subs, ws);
      if (!open(a)) return [r];
      return [
        r,
        ...subs.map((s) => this.subRow(t, s, shown, byPriority)),
        ...ws.flatMap((w, i) => {
          const last = i === ws.length - 1;
          return [row(w, [], [], last ? "└" : "├"), ...wsubs.get(w.address).map((s) => this.subRow(t, s, shown, byPriority, last ? " " : "│"))];
        }),
      ];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row's title is a tab someone named or the agent's own title, never an
    // automatic tab number unless two rows in a space would otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const allPanes = panes();
    const leads = leadPanes(allPanes);
    const tabLabels = new Map(spaces().flatMap(s => {
      const names = tabNames(s.tabs, allPanes);
      return s.tabs.map(tab => [tab.id, tab.named || names.get(tab.id) !== tab.name ? names.get(tab.id) : title(tab, leads.get(tab.id))]);
    }));
    const labels = new Map(order.map(a => [a.address, tabLabels.get(a.tab) ?? (a.title || a.program?.name || "")]));
    const label = (a) => labels.get(a.address);
    const detail = new Map(order.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of order) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of order) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // A small filled tag on line 2 (workers, PRs).
    const chip = (id) => h_flex().id(id).flex_none().h(17).px(5).gap(4).items_center().rounded(4).bg(CHIP_BG).text_size(11.5);
    // The PRs a Pi session watches, as one chip: the first (as pr-watch names it:
    // `#N` here, `repo#N` elsewhere, `merge of #N`) and how many more, the whole
    // list on hover.
    const prs = (a) => {
      const watch = watchOf(a);
      const text = watchText(watch);
      if (!text) return null;
      const watched = [...(Array.isArray(watch.prs) ? watch.prs : []), watch.sha].filter((x) => typeof x === "string" && x);
      return chip(`prs-${a.address}`).max_w(150).text_color(t.foreground + "B3").tooltip(text)
        .when(Boolean(watch.paused), (el) => el.italic())
        .child(svg("mods/eli-agents/git-pull-request.svg").size(11).flex_none())
        .child(div().min_w(0).truncate().child(watched[0]))
        .when(watched.length > 1, (el) => el.child(div().flex_none().text_color(t.dim).child(`+${watched.length - 1}`)));
    };
    // A worker's tree line: an elbow to its first line, continuing for all but the last.
    const treeLine = (line) => v_flex().w(9).ml(8).mr(4).flex_none().self_stretch()
      .child(div().mt(-4).h(14).flex_none().border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.dim))
      .when(line === "├", (el) => el.child(div().flex_1().mb(-4).border_l(1.5).border_color(t.dim)));

    const row = (a, subs = [], ws = [], line = null) => {
      const pic = icon(a.program, 16, t.foreground);
      // An orchestrator opens with focus, so only other rows get a fold control.
      const foldable = ws.length ? [] : subs;
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(jumpOn ? t.working : t.muted).child(mark(a)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      // Live rows (working, needs you, done) read brightest, with a left edge and
      // their time in the status color; idle rows stay readable a step dimmer.
      // No bold: brightness and the edge carry it. An orchestrator's edge is its
      // section's, lifted by its workers; a worker under it has no edge.
      const live = a.status !== "idle";
      const tone = live ? t[a.status] ?? t.dim : null;
      const edge = edgeStatus(a.status, { worker: Boolean(line), orchestrator: ws.length > 0, section: SECTION_STATUS[rankOf(a)] });
      const edgeColor = edge ? t[edge] ?? t.dim : null;
      const isPinned = a.pinned;
      // Two lines: the tab's title gets the first to itself, up to the status and
      // number. The second holds the space (in its color), the orchestration's
      // ticket, then chips for its workers and watched PRs, the machine (when
      // remote) and the time.
      // An automatic tab number says nothing, so the program stands in for it.
      // Under a space header the space goes without saying; without one above
      // (priority, pinned) the second line names it. A worker under its
      // orchestrator leaves out its space too.
      const full = byPriority || isPinned;
      const name = more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const watch = watchOf(a);
      const space = !line && full ? a.space_name : null;
      const ticket = !line && ws.length ? watch?.ticket : null;
      const quiet = t.dim + "D9";
      const body = v_flex()
        .flex_1()
        .min_w(0)
        .child(h_flex().h(22).gap(9).items_center()
          .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
            .when(foldable.length > 0, el => el.on_click((_e, cx) => {
              cx.stop_propagation();
              this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
              cx.notify();
            })).child(pic)))
          .child(div().flex_1().min_w(0).truncate().text_size(14.5).text_color(live || a.focused ? LIVE_TITLE : t.foreground + "E6").child(name))
          .when(foldable.length > 0, el => el.child(fold(a, foldable)))
          .child(this.status(t, a, byPriority && !isPinned))
          .child(number(a)))
        .child(h_flex().h(19).gap(6).items_center().text_size(12.5).text_color(t.dim)
          .child(h_flex().flex_1().min_w(0).items_center()
            .when(Boolean(space), (el) => el.child(div().min_w(0).truncate().text_color(spaceColor(a)).child(space)))
            .when(Boolean(ticket), (el) => el.child(div().flex_none().child(`${space ? " · " : ""}${ticket}`))))
          .when(ws.length > 0, (el) => el.child(chip(`workers-${a.address}`).text_color(t.foreground + "C0").child(`${ws.length} worker${ws.length === 1 ? "" : "s"}`)))
          .when(Boolean(watch && watchText(watch)), (el) => el.child(prs(a)))
          .when(Boolean(machine), el => el.child(div().flex_none().text_size(11.5).text_color(quiet).child(machine)))
          .when(Boolean(when), el => el.child(div().flex_none().text_color(tone ?? quiet).child(duration(now - when)))));
      return h_flex()
        .id(`ag-${a.address}`)
        .relative()
        .px(8)
        .py(4)
        .flex_none()
        .rounded(8)
        // The selected row: a faint wash and a thin outline, not a block, so
        // reading it is no jump. Every row has the border so none shifts.
        .border_1()
        .border_color(a.focused ? t.working + "73" : "#00000000")
        .when(a.focused, (el) => el.bg(t.working + "12"))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .when(Boolean(edgeColor), (el) => el.child(div().absolute().left(0).top(8).bottom(8).w(2.5).rounded(2).bg(edgeColor)))
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(line), (el) => el.child(treeLine(line)))
        .child(body);
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    // The first one sits right under the sidebar's top row: no padding above it.
    const header = (g, first) => {
      const open = !this.folded.has(g.id);
      const top = g.members.flatMap((a) => [a.status, ...workersOf(a).map((w) => kidStatus(w, this.listed))])
        .reduce((m, st) => ((RANK[st] ?? 0) > (RANK[m] ?? 0) ? st : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(first ? 0 : 8)
        .h(first ? 20 : 30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g, i) => [header(g, i === 0), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child(everyone.length
          ? "Every agent is on a hidden machine. Ctrl+G, / chooses which machines show."
          : "No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
