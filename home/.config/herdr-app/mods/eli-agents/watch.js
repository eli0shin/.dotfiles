// Pi's pr-watch.ts labels its herdr-core terminal with its orchestration role
// and the PRs it watches (JSON). Only a terminal still running Pi is trusted:
// the label can outlive the Pi that wrote it.
export const WATCH_LABEL = "dotfiles.pi_pr_watch";

export function piWatch(terminal) {
  if (terminal?.program?.key !== "pi") return null;
  const raw = terminal.labels?.[WATCH_LABEL];
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// "#1901, tool#7 · paused", or null when nothing is watched.
export function watchText(watch) {
  const watched = [...(Array.isArray(watch?.prs) ? watch.prs : []), watch?.sha].filter((s) => typeof s === "string" && s);
  if (!watched.length) return null;
  return watched.join(", ") + (watch.paused ? " · paused" : "");
}

// Workers nest under their orchestrator while it is in the list; a worker
// whose orchestrator is gone stays a row of its own. Workers keep list order.
export function orchestrations(list, watchOf) {
  const orchestrators = new Map();
  for (const a of list) {
    const w = watchOf(a);
    if (w?.role === "orchestrator" && w.orchestration && !orchestrators.has(w.orchestration)) orchestrators.set(w.orchestration, a.address);
  }
  const workers = new Map();
  const nested = new Set();
  for (const a of list) {
    const w = watchOf(a);
    const parent = w?.role === "worker" ? orchestrators.get(w.orchestration) : undefined;
    if (!parent || parent === a.address) continue;
    workers.set(parent, [...(workers.get(parent) ?? []), a]);
    nested.add(a.address);
  }
  return { workers, nested };
}
