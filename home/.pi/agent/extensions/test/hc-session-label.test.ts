import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import hcSessionLabel, { markerDir } from "../hc-session-label.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;
type Emit = (name: string, ctx: unknown) => Promise<void>;

async function withFakeHc(shell: string | undefined, run: (calls: string, emit: Emit, state: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "hc-session-label-"));
  const calls = join(root, "calls");
  const state = join(root, "state");
  await writeFile(join(root, "hc"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`);
  await chmod(join(root, "hc"), 0o755);
  const keys = ["PATH", "HC_TERMINAL_ID", "DOTFILES_HC_SHELL", "XDG_STATE_HOME"] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.PATH = `${root}:${process.env.PATH}`;
  process.env.HC_TERMINAL_ID = "t7";
  process.env.XDG_STATE_HOME = state;
  if (shell) process.env.DOTFILES_HC_SHELL = shell;
  else delete process.env.DOTFILES_HC_SHELL;
  const handlers = new Map<string, Handler[]>();
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) };
  try {
    hcSessionLabel(pi as unknown as ExtensionAPI);
    await run(calls, async (name, ctx) => {
      for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
    }, state);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(root, { recursive: true, force: true });
  }
}

const ctx = (file: string | undefined, mode = "tui") => ({ mode, sessionManager: { getSessionFile: () => file } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test("labels the terminal with the session file and its shell on every turn", async () => {
  await withFakeHc("t7-100-5", async (calls, emit) => {
    await emit("session_start", ctx("/s/a.jsonl"));
    await settle();
    await emit("agent_start", ctx("/s/a.jsonl"));
    await settle();
    await emit("session_start", ctx("/s/b.jsonl"));
    await settle();
    assert.equal(
      await readFile(calls, "utf8"),
      [
        "label t7 dotfiles.pi_session=/s/a.jsonl dotfiles.pi_shell=t7-100-5",
        "label t7 dotfiles.pi_session=/s/a.jsonl dotfiles.pi_shell=t7-100-5",
        "label t7 dotfiles.pi_session=/s/b.jsonl dotfiles.pi_shell=t7-100-5",
        "",
      ].join("\n"),
    );
  });
});

test("leaves a marker named after the shell for the fish hook", async () => {
  await withFakeHc("t7-100-5", async (_calls, emit, state) => {
    await emit("session_start", ctx("/s/a.jsonl"));
    assert.equal(markerDir({ XDG_STATE_HOME: state }), join(state, "dotfiles", "hc-pi"));
    assert.deepEqual(await readdir(join(state, "dotfiles", "hc-pi")), ["t7-100-5"]);
  });
});

test("without a shell token, removes the shell label and leaves no marker", async () => {
  await withFakeHc(undefined, async (calls, emit, state) => {
    await emit("session_start", ctx("/s/a.jsonl"));
    await settle();
    assert.equal(await readFile(calls, "utf8"), "label t7 dotfiles.pi_session=/s/a.jsonl dotfiles.pi_shell=\n");
    await assert.rejects(readdir(join(state, "dotfiles", "hc-pi")), { code: "ENOENT" });
  });
});

test("leaves the label to the TUI and to persisted sessions", async () => {
  await withFakeHc("t7-100-5", async (calls, emit) => {
    await emit("session_start", ctx("/s/a.jsonl", "print"));
    await emit("session_start", ctx(undefined));
    await settle();
    await assert.rejects(readFile(calls, "utf8"), { code: "ENOENT" });
  });
});
