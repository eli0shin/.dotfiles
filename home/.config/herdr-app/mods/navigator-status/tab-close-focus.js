// Closing the shown tab shows the one to its left, like the Herdr TUI
// (Workspace::close_tab); the app picks the one to its right. Closing the
// first tab keeps the app's choice, the new first tab, as the TUI does.
// Settled tabs are skipped, as tab.next/prev skip them. Only the shown space:
// tab.select also shows its space, so a background close keeps the app's choice.
export function createTabCloseFocus({ run }) {
  // Space id -> the tab order and shown tab last seen.
  const seen = new Map();

  return {
    onSpacesChanged(list) {
      const live = new Set();
      for (const space of list) {
        live.add(space.id);
        const tabs = space.tabs.map((t) => t.id);
        let active = space.tabs.find((t) => t.active)?.id;
        const before = seen.get(space.id);
        // No shown tab yet (mid-update): keep the last view to compare against.
        if (!active) continue;
        if (space.active && before && !tabs.includes(before.active)) {
          const open = new Map(space.tabs.map((t) => [t.id, t]));
          const left = before.tabs.slice(0, before.tabs.indexOf(before.active)).reverse();
          const target = left.find((id) => open.has(id) && !open.get(id).settled);
          if (target && target !== active) {
            run("tab.select", { id: target });
            active = target;
          }
        }
        seen.set(space.id, { tabs, active });
      }
      for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
    },
  };
}
