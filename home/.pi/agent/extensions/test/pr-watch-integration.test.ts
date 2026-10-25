import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  initTheme,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

const extension = resolve(import.meta.dirname, "../pr-watch.ts");
const spawnWorker = resolve(import.meta.dirname, "../../../../.agents/skills/orchestrator/scripts/spawn-worker");
const script = fileURLToPath(import.meta.url);

function capturePolling(scheduled = false) {
  const polls: Array<() => Promise<void>> = [];
  const scheduledTimers = new Set<ReturnType<typeof setInterval>>();
  const running = new Set<Promise<void>>();
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const timers = new Set<unknown>();
  globalThis.setInterval = ((callback: () => Promise<void>, ms: number, ...args: any[]) => {
    if (ms !== 60_000 && ms !== 5_000) return originalSet(callback, ms, ...args);
    if (ms === 60_000) polls.push(callback);
    if (scheduled) {
      const timer = originalSet(() => {
        const task = callback();
        running.add(task);
        void task.finally(() => running.delete(task));
      }, 25);
      scheduledTimers.add(timer);
      return timer;
    }
    const timer = { unref() {} };
    timers.add(timer);
    return timer;
  }) as any;
  globalThis.clearInterval = ((timer: any) => {
    if (!timers.has(timer)) originalClear(timer);
  }) as any;
  return {
    polls,
    async stop() {
      for (const timer of scheduledTimers) originalClear(timer);
      await Promise.all(running);
    },
    restore() {
      globalThis.setInterval = originalSet;
      globalThis.clearInterval = originalClear;
    },
  };
}

async function startSession(cwd: string, root: string): Promise<AgentSession> {
  initTheme("dark", false);
  const agentDir = join(root, "agent");
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [extension],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    cwd, agentDir, settingsManager, resourceLoader,
    sessionManager: SessionManager.inMemory(cwd), tools: ["bash"],
  });
  await session.bindExtensions({ mode: "print", onError: (error) => { throw new Error(JSON.stringify(error)); } });
  return session;
}

// Only the model response is scripted. Pi executes the bash tool and dispatches
// its real tool_result/agent_settled events; the test never invokes PR Watch hooks.
async function runCommand(session: AgentSession, command: string): Promise<void> {
  const toolCall = { type: "toolCall", name: "bash", id: "fixture-command", arguments: { command } };
  const model = session.modelRuntime.getModel("openai", "gpt-4o");
  assert.ok(model);
  session.agent.state.model = model;
  await session.modelRuntime.setRuntimeApiKey("openai", "fixture-no-network");
  let turn = 0;
  session.agent.streamFunction = (() => {
    const first = turn++ === 0;
    const message = {
      role: "assistant", content: first ? [toolCall] : [{ type: "text", text: "PR opened." }],
      api: "openai-completions", provider: "openai", model: "gpt-4o",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: first ? "toolUse" : "stop", timestamp: Date.now(),
    };
    return {
      async *[Symbol.asyncIterator]() { yield { type: "done", reason: message.stopReason, message }; },
      async result() { return message; },
    };
  }) as any;
  await session.prompt("Execute the command");
  const result = [...session.messages].reverse().find((message) => message.role === "toolResult" && message.toolCallId === toolCall.id);
  assert.ok(result?.role === "toolResult", "Pi must execute the actual bash call");
  assert.equal(result.isError, false, JSON.stringify(result.content));
}

function watchState(session: AgentSession): any {
  const entry = [...session.sessionManager.getBranch()].reverse().find((entry) => entry.type === "custom" && entry.customType === "pr-watch-state");
  return entry?.type === "custom" ? entry.data : undefined;
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function stopSession(session: AgentSession): Promise<void> {
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  session.dispose();
}

if (process.argv[2] === "worker") {
  const timer = capturePolling();
  const session = await startSession(process.cwd(), process.env.REPRO_ROOT!);
  try {
    // The PR does not exist at startup. Exercise both a literal creation
    // command and a wrapped command that needs settlement-time discovery.
    const automatic = process.env.REPRO_AUTOMATIC === "1";
    if (automatic) {
      await waitUntil(
        () => readFile(join(process.env.REPRO_ROOT!, "parent-idle")).then(() => true, () => false),
        "the parent must settle before the worker opens its PR",
      );
    }
    const command = "gh pr create --base main --title test --body test";
    await runCommand(session, automatic ? command : `sh -c '${command}'`);
    assert.deepEqual(watchState(session).watchedPrs.map(({ pr }: any) => pr.number), [104]);
    assert.equal(watchState(session).latestWorkerSettlement.hadWatchedPr, true);
    if (automatic) await writeFile(join(process.env.REPRO_ROOT!, "ci-complete"), "");
  } finally {
    await stopSession(session);
    timer.restore();
  }
  await writeFile(join(process.env.REPRO_ROOT!, "worker-done"), "");
} else {
  for (const automatic of [false, true]) {
  test(`real Pi worker publishes its PR to an orchestrator on main (${automatic ? "automatic timer, plain command" : "wrapped command"})`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-pr-watch-integration-"));
    const bin = join(root, "bin"), repo = join(root, "repo"), worker = join(root, "worker");
    const envNames = ["PATH", "REPRO_ROOT", "REPRO_WORKER", "PI_PR_WATCH_STATE_DIR", "PI_ORCHESTRATION_SESSION_ID",
      "PI_PARENT_ORCHESTRATION_SESSION_ID", "OPENCODE_ORCHESTRATION_SESSION_ID", "OPENCODE_PARENT_ORCHESTRATION_SESSION_ID", "HERDR_ENV", "REPRO_AUTOMATIC"];
    const original = new Map(envNames.map((name) => [name, process.env[name]]));
    const timer = capturePolling(automatic);
    let session: AgentSession | undefined;
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const executable = (name: string, content: string) => writeFile(join(bin, name), content, { mode: 0o755 });
    try {
      await mkdir(bin); await mkdir(repo);
      process.env.PATH = `${bin}:${process.env.PATH}`;
      process.env.REPRO_ROOT = root;
      process.env.REPRO_WORKER = worker;
      process.env.PI_PR_WATCH_STATE_DIR = join(root, "state");
      process.env.PI_ORCHESTRATION_SESSION_ID = "orchestration-123";
      for (const name of envNames.slice(5)) delete process.env[name];
      process.env.REPRO_AUTOMATIC = automatic ? "1" : "0";
      git("init", "-b", "main");
      git("config", "user.name", "PR Watch Test"); git("config", "user.email", "test@example.invalid");
      git("commit", "--allow-empty", "-m", "initial");
      execFileSync("git", ["init", "--bare", join(root, "remote.git")], { stdio: "ignore" });
      git("remote", "add", "origin", join(root, "remote.git")); git("push", "-u", "origin", "main");
      await executable("gh", `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), marker = process.env.REPRO_ROOT + '/pr-open';
const pr = {number:104,url:'https://github.com/owner/repo/pull/104',headRefName:'ticket-one',headRefOid:'worker-sha',headRepository:{nameWithOwner:'owner/repo'},state:'OPEN',author:{login:'owner'},mergeable:'MERGEABLE'};
if(args[0]==='repo') console.log(JSON.stringify({nameWithOwner:'owner/repo',defaultBranchRef:{name:'main'}}));
else if(args[0]==='pr'&&args[1]==='create') {fs.writeFileSync(marker,'');console.log(pr.url);}
else if(args[0]==='pr'&&args[1]==='view') {if(!fs.existsSync(marker))process.exit(1);console.log(JSON.stringify(pr));}
else if(args[0]==='pr'&&args[1]==='checks') console.log(JSON.stringify(fs.existsSync(process.env.REPRO_ROOT+'/ci-complete') ? [{name:'CI',state:'SUCCESS',bucket:'pass',workflow:'CI',link:'https://github.com/owner/repo/actions/runs/104',completedAt:'2026-07-13T22:00:00Z'}] : []));
else if(args[0]==='api'&&args[1]==='user') console.log(JSON.stringify({login:'owner'}));
else if(args[0]==='api'&&args[1].includes('/commits/')) console.log(JSON.stringify({sha:'main-sha'}));
else console.log('[]');
`);
      await executable("tickets", "#!/bin/sh\nexit 0\n");
      await executable("repos", '#!/bin/sh\nexec git worktree add "$REPRO_WORKER" -b "$3"\n');
      await executable("tmux", `#!/bin/sh
case "$1" in
  has-session) exit 0;;
  send-keys)
    if [ "$2" = '-l' ]; then
      for arg in "$@"; do command=$arg; done
      cd "$REPRO_WORKER" || exit
      if [ "$REPRO_AUTOMATIC" = 1 ]; then
        sh -c "$command" > "$REPRO_ROOT/worker.log" 2>&1 < /dev/null &
      else
        exec sh -c "$command"
      fi
    fi;;
esac
`);
      await executable("pi", `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} worker\n`);
      session = await startSession(repo, root);
      assert.equal(watchState(session).watchedSha.branch, "main");
      await runCommand(session, JSON.stringify(spawnWorker) + " ticket-one");
      if (automatic) {
        // Release the worker only after the parent is idle. From this point the
        // parent receives no user prompt, PR command, or manually invoked poll.
        await writeFile(join(root, "parent-idle"), "");
        const parent = session;
        await waitUntil(
          () => parent.sessionManager.getBranch().some((entry) =>
            entry.type === "custom_message" && entry.customType === "pr-watch-harness" &&
            JSON.stringify(entry.content).includes("CI finished for worker PR #104")),
          "the idle parent must automatically receive its new worker's passing CI",
        );
        await waitUntil(
          () => readFile(join(root, "worker-done")).then(() => true, () => false),
          "the worker must finish successfully",
        );
        assert.equal(parent.messages.filter((message) => message.role === "user").length, 1);
      } else {
        for (const poll of [...timer.polls]) await poll();
      }
      await timer.stop();
      await session.waitForIdle();
      const state = watchState(session);
      assert.equal(state.watchedSha.branch, "main");
      assert.deepEqual(state.watchedPrs.map(({ pr }: any) => pr.number), [104]);
      assert.deepEqual(state.pendingWorkerSettlements, []);
      assert.equal(state.lastError, undefined);
    } finally {
      await timer.stop();
      if (session) await stopSession(session);
      timer.restore();
      for (const [name, value] of original) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
  }
}
