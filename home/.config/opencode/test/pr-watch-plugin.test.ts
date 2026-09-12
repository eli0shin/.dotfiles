import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin from "../plugins/pr-watch/index.ts";
import { atomicWriteJson, registrationPath, stateRoot } from "../lib/pr-watch-ipc.ts";

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
    location: { directory: root },
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

test("only the OpenCode plugin for a session location starts its PR Watch controller", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-plugin-"));
  const firstDirectory = join(root, "first");
  const secondDirectory = join(root, "second");
  const bin = join(root, "bin");
  const calls = join(root, "gh-calls");
  await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory), mkdir(bin)]);
  const gh = join(bin, "gh");
  await writeFile(gh, `#!/bin/sh\nprintf 'call\\n' >> '${calls}'\nprintf '{"login":"eli0shin"}'\n`);
  await chmod(gh, 0o755);
  const oldPath = process.env.PATH;
  const oldStateHome = process.env.XDG_STATE_HOME;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.XDG_STATE_HOME = root;

  const abortWaiters: Array<() => void> = [];
  function context(directory: string) {
    return {
      location: { directory },
      session: {
        hook: async () => ({ dispose: async () => undefined }),
        synthetic: async () => undefined,
        context: async () => [],
      },
      tool: { hook: async () => ({ dispose: async () => undefined }) },
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
  }

  const cleanups: Array<() => Promise<void>> = [];
  try {
    await atomicWriteJson(registrationPath(stateRoot(), "session-one"), {
      version: 1,
      sessionID: "session-one",
      directory: firstDirectory,
      updatedAt: Date.now(),
    });
    cleanups.push(await (plugin.setup as any)(context(firstDirectory)));
    cleanups.push(await (plugin.setup as any)(context(secondDirectory)));
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 1);
  } finally {
    await Promise.all(cleanups.map((cleanup) => cleanup()));
    for (const resolve of abortWaiters) resolve();
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    process.env.PATH = oldPath;
    await rm(root, { recursive: true, force: true });
  }
});
