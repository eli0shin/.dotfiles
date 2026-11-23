// Space colors for the Agents list's space names. Pure: no Herdr imports, so
// tests/herdr-app-agent-colors.mjs loads it directly.

// As the shipped picker keeps them (mods/picker/main.js): by space id in shared
// "space.colors", a theme color name ("ansi6") or a picked #rrggbb. A space seen
// without one gets the color fewest spaces use, once; every mod does the same in
// the same order, so they agree, and adding or renaming spaces moves nothing.
export const SPACE_COLORS_KEY = "space.colors";
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

// The colors to keep for `spaces` ({ id, name }), and whether they differ from `stored`.
export function assignSpaceColors(spaces, stored) {
  const ids = new Set(spaces.map((s) => s.id));
  const kept = Object.fromEntries(Object.entries(stored ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(stored ?? {}).length;
  for (const s of spaces) {
    if (kept[s.id] || s.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[s.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  return { kept, changed };
}

// A space color as text: the tile color lifted toward white so it reads calmly
// beside the titles. null when the space has no color (home, or unknown).
export function spaceTextColor(value) {
  const hex = MARK[value] ?? (/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : null);
  if (!hex) return null;
  const channel = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.72 + 0xe8 * 0.28);
  return `#${[1, 3, 5].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}
