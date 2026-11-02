import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

// Temporary, content-free instrumentation for unexpected expansion. Keep the
// marker searchable so the probes can be removed after a real trace is captured.
export const TRACE_TAG = "[DEBUG-compact-activity]";
export const MAX_TRACE_BYTES = 5 * 1024 * 1024;
type Fields = Record<string, string | number | boolean | null | undefined>;
export type TraceRecord = Fields & { event: string };

function appendRecord(path: string, record: TraceRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  let size = 0;
  try {
    size = statSync(path).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // If rotation fails, skip the record rather than growing the file unbounded.
  if (size >= MAX_TRACE_BYTES) renameSync(path, `${path}.1`);
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export class ActivityTrace {
  readonly path: string;
  readonly enabled: boolean;
  private readonly runId = randomUUID();
  private sequence = 0;
  private nextId = 0;
  private ids = new WeakMap<object, number>();
  private sink: (record: TraceRecord) => void;
  private sessionId: string;

  constructor(sessionId: string, options: {
    path?: string;
    enabled?: boolean;
    sink?: (record: TraceRecord) => void;
  } = {}) {
    this.sessionId = sessionId;
    this.path = options.path ?? join(getAgentDir(), "logs", "compact-activity.jsonl");
    this.enabled = options.enabled ?? process.env.PI_COMPACT_ACTIVITY_TRACE !== "0";
    this.sink = options.sink ?? ((record) => appendRecord(this.path, record));
  }

  id(component: object): number {
    let id = this.ids.get(component);
    if (id === undefined) { id = ++this.nextId; this.ids.set(component, id); }
    return id;
  }

  record(event: string, fields: Fields = {}): void {
    if (!this.enabled) return;
    try {
      this.sink({ ...fields, tag: TRACE_TAG, ts: new Date().toISOString(), pid: process.pid,
        sessionId: this.sessionId, runId: this.runId, seq: ++this.sequence, event });
    } catch {
      // Diagnostics must never break input, rendering, or session cleanup.
    }
  }

  input(data: string): void {
    if (!this.enabled) return;
    // Allowlist normalized control events only. Never retain raw input, ordinary
    // keys, paste payloads, tool arguments/results, component text, or paths.
    if (data === "\x1b[I" || data === "\x1b[O") {
      this.record("terminal-input", { kind: data === "\x1b[I" ? "focus-in" : "focus-out" });
    } else if (matchesKey(data, "ctrl+shift+o") || matchesKey(data, "ctrl+o")) {
      this.record("terminal-input", {
        kind: matchesKey(data, "ctrl+shift+o") ? "latest-shortcut" : "global-shortcut",
        release: isKeyRelease(data),
      });
    } else {
      const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
      if (mouse) this.record("terminal-input", { kind: "mouse", button: Number(mouse[1]),
        x: Number(mouse[2]), y: Number(mouse[3]), release: mouse[4] === "m" });
    }
  }
}
