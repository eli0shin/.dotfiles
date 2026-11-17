// Folders a new space can start in, and fuzzy ranking over them. Pure: no
// Herdr imports, so tests/herdr-app-new-space.mjs loads it directly.

// Where to look, best first: the focused terminal's folder (Enter right away
// starts where you are, like plain space.new), zoxide's frecency order, then
// tracked repos zoxide hasn't seen. No folder is walked, so it's instant.
export function gatherFolders({ focused, zoxide, repos }) {
  const seen = new Set();
  const out = [];
  const add = (path, source) => {
    const clean = trimSlash(path);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({ path: clean, source });
  };
  if (focused) add(focused, "here");
  for (const line of (zoxide ?? "").split("\n")) add(line.trim(), "zoxide");
  for (const path of repos ?? []) add(path, "repo");
  return out;
}

// The paths in a repos config.json (`{ repos: [{ path }] }`); [] when unreadable.
export function reposPaths(configText) {
  try {
    const config = JSON.parse(configText ?? "");
    return Array.isArray(config?.repos)
      ? config.repos.map((repo) => repo?.path).filter((path) => typeof path === "string")
      : [];
  } catch {
    return [];
  }
}

export function displayPath(path, home) {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

// A typed path (`/…`, `~`, `~/…`) as a folder, so any folder stays reachable.
export function typedFolder(query, home) {
  const q = query.trim();
  if (q.startsWith("/")) return trimSlash(q) || "/";
  if (home && (q === "~" || q.startsWith("~/"))) return trimSlash(home + q.slice(1));
  return null;
}

// fzf-like: every space-separated term must match somewhere in the path, in
// any order (a term's letters match in order). A term inside the last segment beats one elsewhere, a match at a
// segment start beats one mid-word, and ties keep the gathered order.
export function rankFolders(query, folders, home) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return folders;
  const scored = [];
  folders.forEach((folder, index) => {
    const shown = displayPath(folder.path, home).toLowerCase();
    let total = 0;
    for (const term of terms) {
      const score = scoreTerm(term, shown);
      if (score === null) return;
      total += score;
    }
    scored.push({ folder, index, total });
  });
  scored.sort((a, b) => b.total - a.total || a.index - b.index);
  return scored.map((entry) => entry.folder);
}

function scoreTerm(term, path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const inBase = base.indexOf(term);
  if (inBase !== -1) {
    // Shorter names win: "repos" over "repos-clean-index-keeps-focus".
    return 1000 + (inBase === 0 ? 200 : 0) + (base.length === term.length ? 300 : 0) - base.length;
  }
  const inPath = path.indexOf(term);
  if (inPath !== -1) return 500 + (path[inPath - 1] === "/" ? 100 : 0) - path.length / 100;
  // In-order letters: reward runs and segment starts.
  let score = 0;
  let at = -1;
  let run = 0;
  for (const char of term) {
    const next = path.indexOf(char, at + 1);
    if (next === -1) return null;
    run = next === at + 1 ? run + 1 : 0;
    score += 1 + run * 2 + (path[next - 1] === "/" || path[next - 1] === "-" ? 3 : 0);
    at = next;
  }
  return score;
}

function trimSlash(path) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
