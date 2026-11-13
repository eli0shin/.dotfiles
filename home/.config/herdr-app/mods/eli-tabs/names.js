// Pi publishes its session name as OSC terminal title. Pi's auto-session-name.ts
// also writes it as the real tab name; this covers unnamed tabs it can't reach.
export function piSessionName(pane) {
  if (pane?.program?.key !== "pi" && pane?.app !== "pi") return null;
  const title = pane.title ?? "";
  if (!title.startsWith("π - ")) return null;
  const rest = title.slice(4);
  const folder = pane.cwd?.replace(/\/+$/, "").split("/").pop();
  if (rest === folder) return null;
  const suffix = folder ? ` - ${folder}` : null;
  const end = suffix && rest.endsWith(suffix) ? rest.length - suffix.length : rest.lastIndexOf(" - ");
  // Unnamed Pi sessions publish only "π - folder".
  return end > 0 ? rest.slice(0, end).replace(/[\x00-\x1f\x7f]/g, "").trim() || null : null;
}

export function tabNames(tabs, panes) {
  const automatic = new Set();
  const names = new Map(tabs.map(tab => {
    if (!tab.named) {
      // Stable pane order, not focus: split tabs must not rename as focus moves.
      const lead = panes.find(p => p.tab === tab.id && (p.program?.key === "pi" || p.app === "pi"));
      const name = piSessionName(lead);
      if (name) { automatic.add(tab.id); return [tab.id, name]; }
    }
    return [tab.id, tab.name];
  }));
  const counts = new Map();
  for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  // Reserve every original name too: a human may already have used our suffix.
  const used = new Set(names.values());
  for (const tab of tabs) {
    const name = names.get(tab.id);
    if (!automatic.has(tab.id) || counts.get(name) < 2) continue;
    const suffix = `${name} · ${tab.index ?? tabs.indexOf(tab) + 1}`;
    let unique = suffix, attempt = 2;
    while (used.has(unique)) unique = `${suffix}.${attempt++}`;
    names.set(tab.id, unique);
    used.add(unique);
  }
  return names;
}
