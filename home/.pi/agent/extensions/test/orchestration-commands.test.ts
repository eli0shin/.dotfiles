import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const functionsDir = resolve(import.meta.dirname, "../../../../.config/fish/functions");
const spawnWorker = resolve(import.meta.dirname, "../../../../.agents/skills/orchestrator/scripts/spawn-worker");

async function executable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function fixture(): Promise<{ root: string; fakeBin: string }> {
  const root = await mkdtemp(join(tmpdir(), "orchestration-command-"));
  const fakeBin = join(root, "bin");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(fakeBin));
  return { root, fakeBin };
}

function decodeInitialPrompt(calls: string): string {
  const match = calls.match(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d/);
  assert.ok(match, "Pi launch command must contain a base64-encoded initial prompt");
  return Buffer.from(match[1], "base64").toString("utf8");
}

test("orchestrate-pi exports a fresh UUID and forwards every Pi argument", async () => {
  const { root, fakeBin } = await fixture();
  const output = join(root, "pi-output");
  await executable(join(fakeBin, "uuidgen"), "#!/bin/sh\nprintf '123e4567-e89b-12d3-a456-426614174000\\n'\n");
  await executable(
    join(fakeBin, "pi"),
    `#!/bin/sh\nprintf '%s\\n' "$PI_ORCHESTRATION_SESSION_ID" > ${JSON.stringify(output)}\nprintf '%s\\n' "$@" >> ${JSON.stringify(output)}\n`,
  );

  try {
    const result = spawnSync(
      "fish",
      [
        "--no-config",
        "-c",
        "source $argv[1]; orchestrate-pi $argv[2..-1]",
        join(functionsDir, "orchestrate-pi.fish"),
        "--model",
        "test-model",
        "hello world",
      ],
      { encoding: "utf8", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
    );

    assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? "");
    assert.equal(
      await readFile(output, "utf8"),
      "123e4567-e89b-12d3-a456-426614174000\n--model\ntest-model\nhello world\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("orchestrate-pi does not start Pi when UUID generation fails", async () => {
  const { root, fakeBin } = await fixture();
  const piRan = join(root, "pi-ran");
  await executable(join(fakeBin, "uuidgen"), "#!/bin/sh\nexit 1\n");
  await executable(join(fakeBin, "pi"), `#!/bin/sh\ntouch ${JSON.stringify(piRan)}\n`);

  try {
    const result = spawnSync(
      "fish",
      ["--no-config", "-c", "source $argv[1]; orchestrate-pi", join(functionsDir, "orchestrate-pi.fish")],
      { encoding: "utf8", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
    );

    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(piRan));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn-worker adds explicit context to the exact ticket handoff", async () => {
  const { root, fakeBin } = await fixture();
  const calls = join(root, "calls");
  const sessionCreated = join(root, "session-created");
  const ticket = "042-implement-widget";

  await executable(join(fakeBin, "tickets"), `#!/bin/sh\nprintf 'tickets %s\\n' "$*" >> ${JSON.stringify(calls)}\n`);
  await executable(
    join(fakeBin, "git"),
    `#!/bin/sh\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(calls)}\ncase "$*" in\n  "branch --show-current") printf 'integration/epic\\n' ;;\n  "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") printf 'origin/integration/epic\\n' ;;\n  "rev-parse HEAD"|"rev-parse @{upstream}") printf 'abc123\\n' ;;\nesac\n`,
  );
  await executable(
    join(fakeBin, "repos"),
    `#!/bin/sh\nprintf 'repos %s\\n' "$*" >> ${JSON.stringify(calls)}\ntouch ${JSON.stringify(sessionCreated)}\n`,
  );
  await executable(
    join(fakeBin, "tmux"),
    `#!/bin/sh\nprintf 'tmux' >> ${JSON.stringify(calls)}\nfor arg in "$@"; do printf ' <%s>' "$arg" >> ${JSON.stringify(calls)}; done\nprintf '\\n' >> ${JSON.stringify(calls)}\nif [ "$1" = "list-sessions" ]; then\n  if [ -f ${JSON.stringify(sessionCreated)} ]; then printf 'configured-repo@042-implement-widget\\n'; fi\n  exit 0\nfi\nif [ "$1" = "has-session" ]; then test -f ${JSON.stringify(sessionCreated)}; fi\n`,
  );

  try {
    const result = spawnSync(
      spawnWorker,
      [ticket, "--context", "  Keep API stable.\nAvoid migrations.  "],
      {
        encoding: "utf8",
        input: "This piped text must be ignored.\n",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PI_ORCHESTRATION_SESSION_ID: "session-123",
        },
      },
    );

    assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? "");
    const prompt =
      "/skill:ticket-worker \n\n" +
      "Ticket: 042-implement-widget\n" +
      "Worker identity: configured-repo@042-implement-widget\n" +
      "PR base: integration/epic\n\n" +
      "Context:\n" +
      "Keep API stable.\n" +
      "Avoid migrations.";
    const encodedPrompt = Buffer.from(prompt).toString("base64");
    assert.equal(
      await readFile(calls, "utf8"),
      "git branch --show-current\n" +
        "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}\n" +
        "git rev-parse HEAD\n" +
        "git rev-parse @{upstream}\n" +
        "tickets show 042-implement-widget\n" +
        "tmux <list-sessions> <-F> <#{session_name}>\n" +
        "repos stack --no-focus 042-implement-widget\n" +
        "tmux <list-sessions> <-F> <#{session_name}>\n" +
        "tmux <send-keys> <-l> <-t> <configured-repo@042-implement-widget:0> <--> " +
        `<env -u PI_ORCHESTRATION_SESSION_ID PI_PARENT_ORCHESTRATION_SESSION_ID=session-123 pi "$(printf %s ${encodedPrompt} | base64 -d)">\n` +
        "tmux <send-keys> <-t> <configured-repo@042-implement-widget:0> <Enter>\n",
    );

    await rm(calls, { force: true });
    await rm(sessionCreated, { force: true });
    const emptyContextResult = spawnSync(
      spawnWorker,
      [ticket, "--context", "  \n"],
      {
        encoding: "utf8",
        input: "This piped text must still be ignored.\n",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PI_ORCHESTRATION_SESSION_ID: "session-123",
        },
      },
    );
    assert.equal(emptyContextResult.status, 0, emptyContextResult.error?.message ?? emptyContextResult.stderr ?? "");
    assert.doesNotMatch(decodeInitialPrompt(await readFile(calls, "utf8")), /Context:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn-worker uses non-empty piped stdin as context", async () => {
  const { root, fakeBin } = await fixture();
  const calls = join(root, "calls");
  const sessionCreated = join(root, "session-created");

  await executable(join(fakeBin, "tickets"), "#!/bin/sh\nexit 0\n");
  await executable(
    join(fakeBin, "git"),
    "#!/bin/sh\ncase \"$*\" in\n  \"branch --show-current\") printf 'main\\n' ;;\n  \"rev-parse --abbrev-ref --symbolic-full-name @{upstream}\") printf 'origin/main\\n' ;;\n  \"rev-parse HEAD\"|\"rev-parse @{upstream}\") printf 'abc123\\n' ;;\nesac\n",
  );
  await executable(join(fakeBin, "repos"), `#!/bin/sh\ntouch ${JSON.stringify(sessionCreated)}\n`);
  await executable(
    join(fakeBin, "tmux"),
    `#!/bin/sh\nprintf 'tmux' >> ${JSON.stringify(calls)}\nfor arg in "$@"; do printf ' <%s>' "$arg" >> ${JSON.stringify(calls)}; done\nprintf '\\n' >> ${JSON.stringify(calls)}\nif [ "$1" = "list-sessions" ]; then\n  if [ -f ${JSON.stringify(sessionCreated)} ]; then printf 'repo@ticket-one\\n'; fi\n  exit 0\nfi\n`,
  );

  try {
    const result = spawnSync(
      spawnWorker,
      ["ticket-one"],
      {
        encoding: "utf8",
        input: "  Prefer the existing adapter.\nKeep the constructor.  \n",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PI_ORCHESTRATION_SESSION_ID: "session-123",
        },
      },
    );

    assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? "");
    assert.match(
      decodeInitialPrompt(await readFile(calls, "utf8")),
      /\n\nContext:\nPrefer the existing adapter\.\nKeep the constructor\.$/,
    );

    await rm(calls, { force: true });
    await rm(sessionCreated, { force: true });
    const emptyContextResult = spawnSync(
      spawnWorker,
      ["ticket-one"],
      {
        encoding: "utf8",
        input: "  \n",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PI_ORCHESTRATION_SESSION_ID: "session-123",
        },
      },
    );
    assert.equal(emptyContextResult.status, 0, emptyContextResult.error?.message ?? emptyContextResult.stderr ?? "");
    assert.doesNotMatch(decodeInitialPrompt(await readFile(calls, "utf8")), /Context:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn-worker fails without a second handoff when repos resumes an existing tmux session", async () => {
  const { root, fakeBin } = await fixture();
  const reposRan = join(root, "repos-ran");
  await executable(join(fakeBin, "tickets"), "#!/bin/sh\nexit 0\n");
  await executable(
    join(fakeBin, "git"),
    "#!/bin/sh\ncase \"$*\" in\n  \"branch --show-current\") printf 'main\\n' ;;\n  \"rev-parse --abbrev-ref --symbolic-full-name @{upstream}\") printf 'origin/main\\n' ;;\n  \"rev-parse HEAD\"|\"rev-parse @{upstream}\") printf 'abc123\\n' ;;\nesac\n",
  );
  await executable(
    join(fakeBin, "tmux"),
    "#!/bin/sh\nif [ \"$1\" = \"list-sessions\" ]; then printf 'example@042-implement-widget\\n'; fi\n",
  );
  await executable(join(fakeBin, "repos"), `#!/bin/sh\ntouch ${JSON.stringify(reposRan)}\n`);

  try {
    const result = spawnSync(
      spawnWorker,
      ["042-implement-widget"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PI_ORCHESTRATION_SESSION_ID: "session-123",
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /repos did not create exactly one new worker session/);
    await readFile(reposRan);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn-worker rejects invalid handoffs before calling dependencies", async () => {
  const { root, fakeBin } = await fixture();
  const called = join(root, "called");
  for (const command of ["git", "tickets", "repos", "tmux"]) {
    await executable(join(fakeBin, command), `#!/bin/sh\ntouch ${JSON.stringify(called)}\n`);
  }
  const source = spawnWorker;

  try {
    const cases = [
      { args: [] as string[], sessionId: "session-123" },
      { args: ["one", "two"], sessionId: "session-123" },
      { args: ["one"], sessionId: undefined },
    ];
    for (const fixtureCase of cases) {
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
      if (fixtureCase.sessionId === undefined) delete env.PI_ORCHESTRATION_SESSION_ID;
      else env.PI_ORCHESTRATION_SESSION_ID = fixtureCase.sessionId;
      const result = spawnSync(source, fixtureCase.args, { encoding: "utf8", env });
      assert.equal(result.status, 2);
    }
    await assert.rejects(readFile(called));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn-worker rejects an unpublished landing branch before creating a worker", async () => {
  const cases = [
    {
      git: "#!/bin/sh\ncase \"$*\" in\n  \"branch --show-current\") printf 'integration/epic\\n' ;;\n  *) exit 1 ;;\nesac\n",
      error: /track a same-named remote branch/,
    },
    {
      git: "#!/bin/sh\ncase \"$*\" in\n  \"branch --show-current\") printf 'integration/epic\\n' ;;\n  \"rev-parse --abbrev-ref --symbolic-full-name @{upstream}\") printf 'origin/integration/epic\\n' ;;\n  \"rev-parse HEAD\") printf 'local-sha\\n' ;;\n  \"rev-parse @{upstream}\") printf 'remote-sha\\n' ;;\nesac\n",
      error: /exactly match its upstream/,
    },
  ];

  for (const fixtureCase of cases) {
    const { root, fakeBin } = await fixture();
    const called = join(root, "called");
    await executable(join(fakeBin, "git"), fixtureCase.git);
    for (const command of ["tickets", "repos", "tmux"]) {
      await executable(join(fakeBin, command), `#!/bin/sh\ntouch ${JSON.stringify(called)}\n`);
    }

    try {
      const result = spawnSync(
        spawnWorker,
        ["one"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            PI_ORCHESTRATION_SESSION_ID: "session-123",
          },
        },
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, fixtureCase.error);
      await assert.rejects(readFile(called));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("spawn-worker rejects a detached HEAD before creating a worker", async () => {
  const { root, fakeBin } = await fixture();
  const called = join(root, "called");
  await executable(join(fakeBin, "git"), "#!/bin/sh\nexit 0\n");
  for (const command of ["tickets", "repos", "tmux"]) {
    await executable(join(fakeBin, command), `#!/bin/sh\ntouch ${JSON.stringify(called)}\n`);
  }

  try {
    const result = spawnSync(
      spawnWorker,
      ["one"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PI_ORCHESTRATION_SESSION_ID: "session-123",
        },
      },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires a named current Git branch/);
    await assert.rejects(readFile(called));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
