// Which agents watch which PRs, and fuzzy ranking over them. Pure: no Herdr
// imports, so tests/herdr-app-pr-finder.mjs loads it directly.

// An agent's watched PRs as { label, repo, number }: label as the Agents list
// shows it (`#N` in the session's repo, `repo#N` elsewhere), repo and number in
// full from the label's `refs` (owner/repo#N). A Pi from before `refs` names
// its own repo's PRs `#N` only; `fallbackRepo` (its space's repo) stands in.
// A SHA watch on a merge counts as that PR.
export function watchedPrs(watch, fallbackRepo) {
  const labels = Array.isArray(watch?.prs) ? watch.prs.filter((p) => typeof p === "string") : [];
  const refs = Array.isArray(watch?.refs) ? watch.refs : [];
  const prs = labels.map((label, i) => split(label, typeof refs[i] === "string" ? refs[i] : null, fallbackRepo));
  const merge = typeof watch?.sha === "string" ? /#(\d+)/.exec(watch.sha) : null;
  if (!prs.length && merge) prs.push({ label: watch.sha, repo: fallbackRepo ?? "", number: merge[1] });
  return prs;
}

function split(label, ref, fallbackRepo) {
  const full = ref ?? (label.startsWith("#") && fallbackRepo ? `${fallbackRepo}${label}` : label);
  const at = full.lastIndexOf("#");
  return { label, repo: at > 0 ? full.slice(0, at) : "", number: at >= 0 ? full.slice(at + 1) : "" };
}

// Every space-separated term must match one PR (a `repo#N` term counts as
// both). A number matches the PR number (exact beats a prefix beats inside);
// words match the repo (its name exact, then its start, then anywhere in
// owner/repo, then letters in order). Each row keeps the PRs that matched,
// best agent first; ties keep the given (Agents list) order. An empty query
// keeps every row and its PRs.
export function rankAgents(query, rows) {
  const terms = query.toLowerCase().split(/\s+/).flatMap((t) => t.split("#")).filter(Boolean);
  if (!terms.length) return rows.map((row) => ({ ...row, matched: row.prs }));
  const scored = [];
  rows.forEach((row, index) => {
    let best = null;
    const matched = [];
    for (const pr of row.prs) {
      let total = 0;
      for (const term of terms) {
        const score = scoreTerm(term, pr);
        if (score === null) { total = null; break; }
        total += score;
      }
      if (total === null) continue;
      matched.push({ pr, total });
      best = best === null ? total : Math.max(best, total);
    }
    if (best === null) return;
    matched.sort((a, b) => b.total - a.total);
    scored.push({ row: { ...row, matched: matched.map((m) => m.pr) }, index, best });
  });
  scored.sort((a, b) => b.best - a.best || a.index - b.index);
  return scored.map((s) => s.row);
}

function scoreTerm(term, pr) {
  if (/^\d+$/.test(term)) {
    const n = pr.number;
    if (n === term) return 1000;
    if (n.startsWith(term)) return 600 - (n.length - term.length);
    return n.includes(term) ? 300 : null;
  }
  const repo = pr.repo.toLowerCase();
  const name = repo.slice(repo.lastIndexOf("/") + 1);
  if (name === term) return 900;
  if (name.startsWith(term)) return 700 - (name.length - term.length);
  const at = repo.indexOf(term);
  if (at !== -1) return 400 + (at === 0 || /[^a-z0-9]/.test(repo[at - 1]) ? 50 : 0);
  // In-order letters: "fmr" finds ffs-mono-repo.
  let score = 0, last = -1;
  for (const char of term) {
    const next = repo.indexOf(char, last + 1);
    if (next === -1) return null;
    score += next === last + 1 ? 3 : 1;
    last = next;
  }
  return score;
}
