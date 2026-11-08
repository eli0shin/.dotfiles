// Lets `dot stow` apply tracked preferences to a running app. The app loads
// shared.json once at launch and rewrites it from memory, so a file edit would
// be ignored and then undone; setShared changes the live values instead.
// `herdr-app do 'navigator-status.set-shared:{"key":value}'`
const PREFIX = "set-shared:";

export function applySharedPreferences(command, { setShared, notify }) {
  if (!command.startsWith(PREFIX)) return false;
  let values;
  try {
    values = JSON.parse(command.slice(PREFIX.length));
  } catch {
    values = null;
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    notify?.({ title: "navigator-status", body: "set-shared needs one JSON object", level: "error" });
    return true;
  }
  for (const [key, value] of Object.entries(values)) setShared(key, value);
  return true;
}
