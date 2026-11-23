// Fuzzy ranking for the spaces picker. Pure: no Herdr imports, so
// tests/herdr-app-space-picker.mjs loads it directly.

// fzf-like: every space-separated term must match the space somewhere, in any
// order (a term's letters match in order). Its name counts most, then its
// branch, folder (as shown, ~ for home) and machine. Within a field a whole
// word beats scattered letters, a match at a word start beats one mid-word,
// and shorter names win. Ties keep the space order.
export function rankSpaces(query, spaces, home) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return spaces;
  const scored = [];
  spaces.forEach((space, index) => {
    const name = (space.name ?? "").toLowerCase();
    const others = [space.branch, displayPath(space.folder ?? "", home), space.machine]
      .filter(Boolean)
      .map((field) => field.toLowerCase());
    let total = 0;
    for (const term of terms) {
      const score = scoreTerm(term, name, others);
      if (score === null) return;
      total += score;
    }
    scored.push({ space, index, total });
  });
  scored.sort((a, b) => b.total - a.total || a.index - b.index);
  return scored.map((entry) => entry.space);
}

export function displayPath(path, home) {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

function scoreTerm(term, name, others) {
  const inName = scoreField(term, name);
  if (inName !== null) return 2000 + inName;
  let best = null;
  for (const field of others) {
    const score = scoreField(term, field);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}

// Higher is better; null when the term's letters aren't all in the field, in order.
function scoreField(term, field) {
  const at = field.indexOf(term);
  if (at !== -1) {
    return 1000 + (at === 0 ? 200 : wordStart(field, at) ? 100 : 0)
      + (field.length === term.length ? 300 : 0) - Math.min(field.length, 100);
  }
  // In-order letters: reward runs and word starts ("pf" → photo-frame).
  let score = 0;
  let last = -1;
  let run = 0;
  for (const char of term) {
    const next = field.indexOf(char, last + 1);
    if (next === -1) return null;
    run = next === last + 1 ? run + 1 : 0;
    score += 1 + run * 2 + (wordStart(field, next) ? 3 : 0);
    last = next;
  }
  return score;
}

function wordStart(text, at) {
  return at === 0 || /[^a-z0-9]/.test(text[at - 1]);
}

// The tab to show when going to a space: its selected tab unless that's an
// agent's (or another `hidden` one), else its first terminal tab; null when
// it has none, so the space opens as it was.
export function terminalTab(space, hidden) {
  const tabs = space?.tabs ?? [];
  const active = tabs.find((tab) => tab.active);
  if (active && !hidden.has(active.id)) return active;
  return tabs.find((tab) => !hidden.has(tab.id)) ?? null;
}
