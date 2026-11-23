// Personal clone of the shipped workspace-chrome: the sidebar's top row (the
// eli layout parks the macOS traffic lights off the window). It is also the Agents list's header (the label, the
// machine filter and the sort), so the list starts right under it instead of
// under a brand row and a header of its own. No search or sidebar buttons:
// Cmd+P and Ctrl+G, B do those. The row's height and padding match the tab bar's.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared, layout, openOverlay } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag (as eli-agents reads it).
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
// Keep in sync with eli-agents/main.js (its sort menu sets "agents.sort").
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
// Keep in sync with eli-agents/main.js, agent-machines/main.js and navigator-status/agent-order.js.
const HIDDEN_MACHINES_KEY = "dotfiles.agents.hidden-machines";

export default class EliChrome extends View {
  render() {
    const t = theme();
    // Same 6px over / 3px under as the tab bar, so "Agents" lines up with the tabs.
    const row = h_flex().size_full().bg(t.chrome).pl(16).pr(14).pt(6).pb(3).gap(10).items_center();
    // The rail is too narrow for the header; the list's » unfolds it.
    if (narrow()) return row;
    const sort = sortOf();
    const hidden = (shared(HIDDEN_MACHINES_KEY) ?? []).length;
    // The row drags the window, so its buttons keep their presses.
    const button = (id) => h_flex().id(id).gap(4).items_center().text_size(11).text_color(t.dim)
      .hover((s) => s.text_color(t.foreground)).on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    return row
      .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
      // Which machines' agents show (Ctrl+G, / opens the same popup). While some
      // are hidden it says how many, in the accent of a filter that's on.
      .child(button("ag-machines")
        .when(hidden > 0, (el) => el.text_color(t.working))
        .on_click(() => openOverlay({ mod: "agent-machines", kind: "popup", width: 280, height: 260 }))
        .tooltip(hidden ? `Agents hidden on ${hidden} machine${hidden === 1 ? "" : "s"} (Ctrl+G, /)` : "Filter agents by machine (Ctrl+G, /)")
        .child(svg("mods/workspace-chrome/monitor.svg").size(14))
        .when(hidden > 0, (el) => el.child(`${hidden} hidden`)))
      .child(button("ag-sort")
        .on_click(() => openOverlay({ mod: "eli-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
        .tooltip(`Sort agents: ${sort.label}`)
        .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)));
  }
}
