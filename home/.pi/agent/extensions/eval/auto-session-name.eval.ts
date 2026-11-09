// Live eval for auto-session-name.ts: replays fixed conversations through the real extension and the real
// naming model, then scores each title check over repeated runs. Model output is noisy, so compare variants
// at 10 runs and change one thing at a time.
//
//   npm run eval:session-name [-- --runs 10] [-- --ext /path/to/variant.ts]
//   npm run eval:session-name -- snapshot <session.jsonl> <last-user-entry-id> <case name>
//
// Committed cases are synthetic because this repo is public. `snapshot` writes a real session to the
// gitignored session-name-cases-local.json; add its checks by hand, and the eval runs those cases too.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

type Message = { role: "user" | "assistant"; text: string; skill?: string };
type Check = { at: number; equals?: string; includes?: string[]; excludes?: string[] } | { same: [number, number] };
type Case = { name: string; messages: Message[]; checks: Check[] };

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(here, "../../../../.agents/skills");
const CASE_FILES = [join(here, "session-name-cases.json"), join(here, "session-name-cases-local.json")];
const HARNESS = /^<(?:pr-watch-harness-notification|orchestrator-message|worker-message|slack-watch-harness-notification)>/;

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

// Matches how Pi expands /skill:name into the first user message.
function skillText(skill: string, args: string): string {
  const location = join(SKILLS, skill, "SKILL.md");
  const body = readFileSync(location, "utf8").replace(/^---[\s\S]*?---\n/, "");
  return `<skill name="${skill}" location="${location}">\nReferences are relative to ${dirname(location)}.\n\n${body}\n</skill>${args ? `\n\n${args}` : ""}`;
}

function snapshot([file, leaf, ...name]: string[]): void {
  if (!file || !leaf || !name.length) throw new Error("usage: snapshot <session.jsonl> <last-user-entry-id> <case name>");
  const entries = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const branch: any[] = [];
  for (let entry = byId.get(leaf); entry; entry = byId.get(entry.parentId)) branch.unshift(entry);
  const messages: Message[] = [];
  for (const entry of branch) {
    if (entry.type !== "message" || !["user", "assistant"].includes(entry.message.role)) continue;
    const content = entry.message.content;
    const text = typeof content === "string" ? content : content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    if (text.trim()) messages.push({ role: entry.message.role, text });
  }
  const local = CASE_FILES[1];
  const cases: Case[] = existsSync(local) ? JSON.parse(readFileSync(local, "utf8")) : [];
  cases.push({ name: name.join(" "), messages, checks: [] });
  writeFileSync(local, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`Added "${name.join(" ")}" (${messages.length} messages) to ${local}; add its checks there.`);
}

async function main(): Promise<void> {
  if (process.argv[2] === "snapshot") return snapshot(process.argv.slice(3));
  const runs = Number(option("runs") ?? 5);
  const ext = resolve(option("ext") ?? join(here, "../auto-session-name.ts"));
  const { default: autoSessionName } = await import(ext);
  const runtime = await ModelRuntime.create();
  const registry = new ModelRegistry(runtime);
  const model = runtime.getModel("anthropic", option("model") ?? "claude-opus-5-5");
  if (!model) throw new Error("Main model not found; pass --model <anthropic model id>");

  // Returns the session name after each real (non-harness) user message, as the TUI would show it.
  async function replay(messages: Message[]): Promise<(string | undefined)[]> {
    const manager = SessionManager.inMemory();
    const handlers = new Map<string, Function[]>();
    let inflight = 0;
    const ctx: any = {
      mode: "tui", model, sessionManager: manager, ui: { notify: () => {} },
      modelRegistry: {
        getAll: () => registry.getAll(),
        streamSimple: (...args: Parameters<ModelRegistry["streamSimple"]>) => {
          inflight++;
          const stream = registry.streamSimple(...args);
          return { result: () => stream.result().finally(() => inflight--) };
        },
      },
    };
    const pi: any = {
      on: (event: string, handler: Function) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      registerCommand: () => {},
      appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
      getSessionName: () => manager.getSessionName(),
      setSessionName: (name: string) => {
        manager.appendSessionInfo(name);
        for (const handler of handlers.get("session_info_changed") ?? []) handler({ name }, ctx);
      },
    };
    const emit = async (event: string, data: unknown = {}) => { for (const handler of handlers.get(event) ?? []) await handler(data, ctx); };
    const settle = async () => {
      await new Promise(r => setTimeout(r, 30));
      while (inflight > 0) await new Promise(r => setTimeout(r, 100));
    };
    autoSessionName(pi);
    await emit("session_start");
    await settle();
    const names: (string | undefined)[] = [];
    for (const m of messages) {
      const text = m.skill ? skillText(m.skill, m.text) : m.text;
      const message: any = m.role === "user"
        ? { role: "user", content: text, timestamp: Date.now() }
        : { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() };
      const real = m.role === "user" && !HARNESS.test(text);
      if (real) await emit("message_end", { message });
      manager.appendMessage(message);
      if (real) { await settle(); names.push(manager.getSessionName()); }
    }
    await emit("session_shutdown");
    return names;
  }

  function judge(check: Check, names: (string | undefined)[]): boolean {
    if ("same" in check) return !!names[check.same[0]] && names[check.same[0]] === names[check.same[1]];
    const title = names[check.at]?.toLowerCase();
    if (!title) return false;
    if (check.equals !== undefined && title !== check.equals.toLowerCase()) return false;
    if (check.includes && !check.includes.some(word => title.includes(word.toLowerCase()))) return false;
    return !check.excludes?.some(word => title.includes(word.toLowerCase()));
  }
  const label = (check: Check) => "same" in check
    ? `#${check.same[1] + 1} keeps #${check.same[0] + 1}`
    : `#${check.at + 1} ${check.equals !== undefined ? `= ${check.equals}` : ""}${check.includes ? `has ${check.includes.join("|")}` : ""}${check.excludes ? ` not ${check.excludes.join("|")}` : ""}`;

  const cases: Case[] = CASE_FILES.filter(existsSync).flatMap(file => JSON.parse(readFileSync(file, "utf8")));
  let passed = 0, total = 0;
  for (const c of cases) {
    if (!c.checks.length) { console.log(`${c.name}: no checks, skipped`); continue; }
    const results = await Promise.all(Array.from({ length: runs }, () => replay(c.messages)));
    for (const check of c.checks) {
      const ok = results.filter(names => judge(check, names)).length;
      passed += ok; total += runs;
      console.log(`${`${c.name}: ${label(check)}`.padEnd(64)} ${ok}/${runs}`);
    }
    console.log(`  ${results.map(names => names.map(n => n ?? "∅").join(" → ")).join(" | ")}`);
  }
  console.log(`SCORE ${passed}/${total}`);
}

await main();
