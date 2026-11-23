// The machine filter's rows and changes. Pure: no Herdr imports, so
// tests/herdr-app-agent-machines.mjs loads it directly. A machine is keyed by
// its name, "" for this computer; the filter stores the hidden keys, so a
// machine connected later shows until it's hidden.

// This computer first, then connected machines in Herdr's order, then any
// machine that's only known from an agent or the hidden list (offline now).
export function machineRows(known, agentMachines, hidden) {
  const counts = new Map();
  for (const key of agentMachines) counts.set(key, (counts.get(key) ?? 0) + 1);
  const keys = ["", ...known.map((m) => m.name).filter(Boolean)];
  const live = new Set(keys);
  for (const key of [...counts.keys(), ...hidden]) if (!keys.includes(key)) keys.push(key);
  return keys.map((key) => ({
    key,
    label: key || "This computer",
    count: counts.get(key) ?? 0,
    hidden: hidden.includes(key),
    offline: !live.has(key) || known.find((m) => (m.name ?? "") === key)?.layout === "unavailable",
  }));
}

export function toggleMachine(hidden, key) {
  return hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
}

// Hide every listed machine but `key`.
export function onlyMachine(rows, key) {
  return rows.filter((r) => r.key !== null && r.key !== key).map((r) => r.key);
}
