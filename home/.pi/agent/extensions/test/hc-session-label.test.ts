import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import hcSessionLabel from "../hc-session-label.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

async function withFakeHc(run: (calls: string, emit: (name: string, ctx: unknown) => Promise<void>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "hc-session-label-"));
  const calls = join(root, "calls");
  await writeFile(join(root, "hc"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`);
  await chmod(join(root, "hc"), 0o755);
  const saved = { PATH: process.env.PATH, HC_TERMINAL_ID: process.env.HC_TERMINAL_ID };
  process.env.PATH = `${root}:${process.env.PATH}`;
  process.env.HC_TERMINAL_ID = "t7";
  const handlers = new Map<string, Handler[]>();
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) };
  try {
    hcSessionLabel(pi as unknown as ExtensionAPI);
    await run(calls, async (name, ctx) => {
      for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
    });
  } finally {
    Object.assign(process.env, saved);
    if (saved.HC_TERMINAL_ID === undefined) delete process.env.HC_TERMINAL_ID;
    await rm(root, { recursive: true, force: true });
  }
}

const ctx = (file: string | undefined, mode = "tui") => ({ mode, sessionManager: { getSessionFile: () => file } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test("labels the herdr-core terminal with each new TUI session file", async () => {
  await withFakeHc(async (calls, emit) => {
    await emit("session_start", ctx("/s/a.jsonl"));
    await settle();
    await emit("agent_start", ctx("/s/a.jsonl"));
    await emit("session_start", ctx("/s/b.jsonl"));
    await settle();
    assert.equal(await readFile(calls, "utf8"), "label t7 dotfiles.pi_session=/s/a.jsonl\nlabel t7 dotfiles.pi_session=/s/b.jsonl\n");
  });
});

test("leaves the label to the TUI and to persisted sessions", async () => {
  await withFakeHc(async (calls, emit) => {
    await emit("session_start", ctx("/s/a.jsonl", "print"));
    await emit("session_start", ctx(undefined));
    await settle();
    await assert.rejects(readFile(calls, "utf8"), { code: "ENOENT" });
  });
});
