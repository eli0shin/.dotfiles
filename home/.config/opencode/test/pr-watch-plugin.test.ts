import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { withOrchestrationEnvironment } from "../plugins/pr-watch/index.ts";
import { atomicWriteJson, readJson, registrationPath, sessionStatePath, stateRoot } from "../lib/pr-watch-ipc.ts";

test("OpenCode shell commands receive only the OpenCode orchestration marker", () => {
  const command = withOrchestrationEnvironment("echo ready", "parent'id");
  assert.equal(command, "export OPENCODE_ORCHESTRATION_SESSION_ID='parent'\\''id'; echo ready");
  assert.doesNotMatch(command, /PI_ORCHESTRATION_SESSION_ID/);
});

test("a standalone OpenCode Mini worker publishes its orchestration membership", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-plugin-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "gh"), '#!/bin/sh\nprintf \'{"login":"eli0shin"}\'\n', { mode: 0o755 });
  await writeFile(join(bin, "git"), '#!/bin/sh\nprintf \'worker-branch\\n\'\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  const oldStateHome = process.env.XDG_STATE_HOME;
  const oldWorkerOrchestrationID = process.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.XDG_STATE_HOME = root;
  process.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID = "parent-id";

  let contextHook: ((event: any) => Promise<void>) | undefined;
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
    tool: { hook: async () => ({ dispose: async () => undefined }) },
    shell: { hook: async () => ({ dispose: async () => undefined }) },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        },
      }),
    },
  };

  let cleanup: (() => Promise<void>) | undefined;
  try {
    cleanup = await (plugin.setup as any)(context);
    assert.ok(contextHook);
    const event = { sessionID: "worker-session", system: [] };
    await contextHook(event);
    const snapshot = JSON.parse(
      await readFile(join(root, "opencode", "pr-watch", "orchestrations", "parent-id", "worker-session.json"), "utf8"),
    );
    assert.equal(snapshot.orchestrationId, "parent-id");
    assert.equal(snapshot.branch, "worker-branch");
  } finally {
    await cleanup?.();
    process.env.PATH = oldPath;
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    if (oldWorkerOrchestrationID === undefined) delete process.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID;
    else process.env.OPENCODE_PARENT_ORCHESTRATION_SESSION_ID = oldWorkerOrchestrationID;
    await rm(root, { recursive: true, force: true });
  }
});

test("the server process environment cannot promote an ordinary PR Watch session", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-plugin-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "gh"), '#!/bin/sh\nprintf \'{"login":"eli0shin"}\'\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  const oldStateHome = process.env.XDG_STATE_HOME;
  const oldOrchestrationID = process.env.OPENCODE_ORCHESTRATION_SESSION_ID;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.XDG_STATE_HOME = root;
  process.env.OPENCODE_ORCHESTRATION_SESSION_ID = "parent-id";

  let contextHook: ((event: any) => Promise<void>) | undefined;
  let shellHook: ((event: any) => void) | undefined;
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
    tool: { hook: async () => ({ dispose: async () => undefined }) },
    shell: {
      hook: async (_name: string, callback: (event: any) => void) => {
        shellHook = callback;
        return { dispose: async () => undefined };
      },
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        },
      }),
    },
  };

  let cleanup: (() => Promise<void>) | undefined;
  try {
    cleanup = await (plugin.setup as any)(context);
    assert.ok(contextHook);
    assert.ok(shellHook);
    const shell = {
      env: {
        PATH: "/bin",
        OPENCODE_ORCHESTRATION_SESSION_ID: "foreign-parent",
        OPENCODE_PARENT_ORCHESTRATION_SESSION_ID: "foreign-worker-parent",
        PI_ORCHESTRATION_SESSION_ID: "foreign-pi-parent",
        PI_PARENT_ORCHESTRATION_SESSION_ID: "foreign-pi-worker-parent",
      },
    };
    shellHook(shell);
    assert.deepEqual(shell.env, { PATH: "/bin" });
    await contextHook({ sessionID: "ordinary", system: [] });
    const state = await readJson<{ orchestrationSessionId?: string }>(sessionStatePath(stateRoot(), "ordinary"));
    assert.equal(state?.orchestrationSessionId, undefined);
  } finally {
    await cleanup?.();
    process.env.PATH = oldPath;
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    if (oldOrchestrationID === undefined) delete process.env.OPENCODE_ORCHESTRATION_SESSION_ID;
    else process.env.OPENCODE_ORCHESTRATION_SESSION_ID = oldOrchestrationID;
    await rm(root, { recursive: true, force: true });
  }
});

test("the OpenCode adapter adds PR Watch harness guidance to active sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-plugin-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const gh = join(bin, "gh");
  await writeFile(gh, '#!/bin/sh\nprintf \'{"login":"eli0shin"}\'\n');
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
    shell: { hook: async () => ({ dispose: async () => undefined }) },
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
    const event = {
      sessionID: "session-one",
      system: [] as Array<{ text: string }>,
    };
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
  const contextHooks = new Map<string, (event: any) => Promise<void>>();
  function context(directory: string) {
    return {
      location: { directory },
      session: {
        hook: async (name: string, callback: (event: any) => Promise<void>) => {
          if (name === "context") contextHooks.set(directory, callback);
          return { dispose: async () => undefined };
        },
        synthetic: async () => undefined,
        context: async () => [],
      },
      tool: { hook: async () => ({ dispose: async () => undefined }) },
      shell: { hook: async () => ({ dispose: async () => undefined }) },
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
    await contextHooks.get(firstDirectory)!({ sessionID: "session-one", system: [] });
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

test("a server does not claim another server's session at the same location", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-plugin-"));
  const bin = join(root, "bin");
  const calls = join(root, "gh-calls");
  await mkdir(bin);
  await writeFile(join(bin, "gh"), `#!/bin/sh\nprintf 'call\\n' >> '${calls}'\nprintf '{"login":"eli0shin"}'\n`, {
    mode: 0o755,
  });
  const oldPath = process.env.PATH;
  const oldStateHome = process.env.XDG_STATE_HOME;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.XDG_STATE_HOME = root;

  const contextHooks: Array<(event: any) => Promise<void>> = [];
  const abortWaiters: Array<() => void> = [];
  function context() {
    return {
      location: { directory: root },
      session: {
        hook: async (name: string, callback: (event: any) => Promise<void>) => {
          if (name === "context") contextHooks.push(callback);
          return { dispose: async () => undefined };
        },
        synthetic: async () => undefined,
        context: async () => [],
      },
      tool: { hook: async () => ({ dispose: async () => undefined }) },
      shell: { hook: async () => ({ dispose: async () => undefined }) },
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
      directory: root,
      updatedAt: Date.now(),
    });
    cleanups.push(await (plugin.setup as any)(context()));
    cleanups.push(await (plugin.setup as any)(context()));
    assert.equal(contextHooks.length, 2);
    await contextHooks[0]!({ sessionID: "session-one", system: [] });
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 1);
  } finally {
    await Promise.all(cleanups.map((cleanup) => cleanup()));
    for (const resolve of abortWaiters) resolve();
    process.env.PATH = oldPath;
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("one failed OpenCode event does not stop later PR Watch events", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-pr-watch-plugin-"));
  const oldStateHome = process.env.XDG_STATE_HOME;
  const oldConsoleError = console.error;
  process.env.XDG_STATE_HOME = root;
  console.error = () => undefined;
  const events: any[] = [];
  let wake: (() => void) | undefined;
  let contextCalls = 0;
  const context = {
    location: { directory: root },
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      synthetic: async () => undefined,
      context: async () => {
        contextCalls += 1;
        if (contextCalls === 1) throw new Error("transient context failure");
        return [];
      },
    },
    tool: { hook: async () => ({ dispose: async () => undefined }) },
    shell: { hook: async () => ({ dispose: async () => undefined }) },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            if (events.length === 0) {
              await new Promise<void>((resolve) => {
                wake = resolve;
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
            }
            while (events.length > 0) yield events.shift();
          }
        },
      }),
    },
  };
  const emit = (event: any) => {
    events.push(event);
    wake?.();
    wake = undefined;
  };

  let cleanup: (() => Promise<void>) | undefined;
  try {
    cleanup = await (plugin.setup as any)(context);
    const event = {
      type: "session.execution.started",
      location: { directory: root },
      data: { sessionID: "session-one" },
    };
    emit(event);
    emit(event);
    const deadline = Date.now() + 1_000;
    while (contextCalls < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(contextCalls, 2);
  } finally {
    await cleanup?.();
    console.error = oldConsoleError;
    if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldStateHome;
    await rm(root, { recursive: true, force: true });
  }
});
