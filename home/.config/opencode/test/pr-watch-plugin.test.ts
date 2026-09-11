import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin from "../plugins/pr-watch/index.ts";

test("the OpenCode adapter adds PR Watch harness guidance to active sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-plugin-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const gh = join(bin, "gh");
  await writeFile(gh, "#!/bin/sh\nprintf '{\"login\":\"eli0shin\"}'\n");
  await chmod(gh, 0o755);
  const oldPath = process.env.PATH;
  const oldStateHome = process.env.XDG_STATE_HOME;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.XDG_STATE_HOME = root;

  let contextHook: ((event: any) => Promise<void>) | undefined;
  const abortWaiters: Array<() => void> = [];
  const context = {
    session: {
      hook: async (name: string, callback: (event: any) => Promise<void>) => {
        if (name === "context") contextHook = callback;
        return { dispose: async () => undefined };
      },
      synthetic: async () => undefined,
      context: async () => [],
    },
    tool: {
      hook: async () => ({ dispose: async () => undefined }),
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            abortWaiters.push(resolve);
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      }),
    },
  };

  let cleanup: (() => Promise<void>) | undefined;
  try {
    cleanup = await (plugin.setup as any)(context);
    assert.ok(contextHook);
    const event = { sessionID: "session-one", system: [] as Array<{ text: string }> };
    await contextHook(event);
    assert.match(event.system.at(-1)?.text ?? "", /PR Watch monitors CI/);
  } finally {
    await cleanup?.();
    for (const resolve of abortWaiters) resolve();
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    process.env.PATH = oldPath;
    await rm(root, { recursive: true, force: true });
  }
});
