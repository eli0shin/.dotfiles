import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const functionsDir = resolve(import.meta.dirname, "../../../../.config/fish/functions");
const spawnWorker = resolve(import.meta.dirname, "../../../../.agents/skills/orchestrator/scripts/spawn-worker");
for (const name of ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) {
  delete process.env[name];
}

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

async function readInitialPrompt(calls: string): Promise<string> {
  const match = calls.match(/<bash (\/tmp\/pi-worker\.[A-Za-z0-9]+)>/);
  assert.ok(match, "Pi launch command must contain only a short launcher path");
  const launcher = match[1];
  const { root, fakeBin } = await fixture();
  try {
    assert.equal((await stat(launcher)).mode & 0o777, 0o600);
    await executable(join(fakeBin, "pi"), `#!/bin/sh
[ -z "\${PI_ORCHESTRATION_SESSION_ID+x}" ] || exit 3
[ "$PI_PARENT_ORCHESTRATION_SESSION_ID" = session-123 ] || exit 4
[ "$#" = 1 ] || exit 5
printf '%s' "$1"
`);
    const result = spawnSync("fish", ["--no-config", "-c", `bash ${launcher}`], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, PI_ORCHESTRATION_SESSION_ID: "outer-session" },
    });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(stat(launcher), { code: "ENOENT" });
    return result.stdout;
  } finally {
    await rm(launcher, { force: true });
    await rm(root, { recursive: true, force: true });
  }
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

test("orchestrate-opencode exports one UUID for OpenCode and Pi workers and forwards arguments", async () => {
  const { root, fakeBin } = await fixture();
  const output = join(root, "opencode-output");
  await executable(join(fakeBin, "uuidgen"), "#!/bin/sh\nprintf '123e4567-e89b-12d3-a456-426614174000\\n'\n");
  await executable(
    join(fakeBin, "opencode2"),
    `#!/bin/sh\nprintf '%s\\n' "$OPENCODE_ORCHESTRATION_SESSION_ID" > ${JSON.stringify(output)}\nprintf '%s\\n' "$PI_ORCHESTRATION_SESSION_ID" >> ${JSON.stringify(output)}\nprintf '%s\\n' "$@" >> ${JSON.stringify(output)}\n`,
  );

  try {
    const result = spawnSync(
      "fish",
      [
        "--no-config",
        "-c",
        "source $argv[1]; orchestrate-opencode $argv[2..-1]",
        join(functionsDir, "orchestrate-opencode.fish"),
        "--model",
        "test-model",
        "hello world",
      ],
      { encoding: "utf8", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
    );

    assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? "");
    assert.equal(
      await readFile(output, "utf8"),
      "123e4567-e89b-12d3-a456-426614174000\n123e4567-e89b-12d3-a456-426614174000\n--model\ntest-model\nhello world\n",
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
    const log = await readFile(calls, "utf8");
    assert.equal(await readInitialPrompt(log), prompt);
    assert.equal(
      log.replace(/<bash \/tmp\/pi-worker\.[A-Za-z0-9]+>/, "<bash LAUNCHER>"),
      "git branch --show-current\n" +
        "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}\n" +
        "git rev-parse HEAD\n" +
        "git rev-parse @{upstream}\n" +
        "tickets show 042-implement-widget\n" +
        "tmux <list-sessions> <-F> <#{session_name}>\n" +
        "repos stack --no-focus 042-implement-widget\n" +
        "tmux <list-sessions> <-F> <#{session_name}>\n" +
        "tmux <send-keys> <-l> <-t> <configured-repo@042-implement-widget:0> <--> " +
        "<bash LAUNCHER>\n" +
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
    assert.doesNotMatch(await readInitialPrompt(await readFile(calls, "utf8")), /Context:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn-worker launches Pi in the new Herdr Managed Workspace", async () => {
  const { root, fakeBin } = await fixture();
  const calls = join(root, "calls");
  const workspaceCreated = join(root, "workspace-created");
  const ticket = "042-implement-widget";

  await executable(join(fakeBin, "tickets"), "#!/bin/sh\nexit 0\n");
  await executable(
    join(fakeBin, "git"),
    "#!/bin/sh\ncase \"$*\" in\n  \"branch --show-current\") printf 'main\\n' ;;\n  \"rev-parse --abbrev-ref --symbolic-full-name @{upstream}\") printf 'origin/main\\n' ;;\n  \"rev-parse HEAD\"|\"rev-parse @{upstream}\") printf 'abc123\\n' ;;\nesac\n",
  );
  await executable(join(fakeBin, "repos"), `#!/bin/sh\ntouch ${JSON.stringify(workspaceCreated)}\n`);
  await executable(
    join(fakeBin, "herdr"),
    `#!/bin/sh
printf 'herdr' >> ${JSON.stringify(calls)}
for arg in "$@"; do printf ' <%s>' "$arg" >> ${JSON.stringify(calls)}; done
printf '\n' >> ${JSON.stringify(calls)}
if [ "$1 $2" = "workspace list" ]; then
  if [ -f ${JSON.stringify(workspaceCreated)} ]; then
    printf '%s\n' '{"id":"test","result":{"type":"workspace_list","workspaces":[{"workspace_id":"w2","label":"repo@main"},{"workspace_id":"w3","label":"repo@042-implement-widget"}]}}'
  else
    printf '%s\n' '{"id":"test","result":{"type":"workspace_list","workspaces":[{"workspace_id":"w2","label":"repo@main"}]}}'
  fi
fi
if [ "$1 $2" = "pane list" ]; then
  printf '%s\n' '{"id":"test","result":{"type":"pane_list","panes":[{"workspace_id":"w2","pane_id":"w2:p1"},{"workspace_id":"w3","pane_id":"w3:p1"}]}}'
fi
`,
  );

  try {
    const result = spawnSync(spawnWorker, [ticket, "--context", "Keep API stable."], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        HERDR_ENV: "1",
        PI_ORCHESTRATION_SESSION_ID: "session-123",
      },
    });

    assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? "");
    const log = await readFile(calls, "utf8");
    assert.match(log, /herdr <workspace> <list>/);
    assert.doesNotMatch(log, /--json/);
    assert.match(log, /herdr <pane> <run> <w3:p1>/);
    assert.match(log, /<w3:p1> <bash \/tmp\/pi-worker\./);
    assert.equal(await readInitialPrompt(log), "/skill:ticket-worker \n\nTicket: 042-implement-widget\nWorker identity: repo@042-implement-widget\nPR base: main\n\nContext:\nKeep API stable.");
    assert.doesNotMatch(log, /tmux/);
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
      await readInitialPrompt(await readFile(calls, "utf8")),
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
    assert.doesNotMatch(await readInitialPrompt(await readFile(calls, "utf8")), /Context:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn-worker delivers long context without sending it through terminal input", async () => {
  for (const manager of ["tmux", "herdr"]) {
    const { root, fakeBin } = await fixture();
    const created = join(root, "created");
    const commandFile = join(root, "command");
    const received = join(root, "received");
    const context = "Steering: keep café labels. 'quoted' \"text\" $HOME $(false) `false` \\path\n".repeat(20);
    await executable(join(fakeBin, "tickets"), "#!/bin/sh\nexit 0\n");
    await executable(join(fakeBin, "git"), `#!/bin/sh
case "$*" in
  "branch --show-current") echo main ;;
  "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") echo origin/main ;;
  *) echo abc123 ;;
esac
`);
    await executable(join(fakeBin, "repos"), `#!/bin/sh\ntouch ${JSON.stringify(created)}\n`);
    await executable(join(fakeBin, "tmux"), `#!/bin/sh
if [ "$1" = list-sessions ]; then
  if [ -f ${JSON.stringify(created)} ]; then echo repo@ticket-one; fi
elif [ "$2" = -l ]; then
  printf '%s' "$6" > ${JSON.stringify(commandFile)}
  exit "\${FAIL_DISPATCH:-0}"
else
  exit "\${FAIL_ENTER:-0}"
fi
`);
    await executable(join(fakeBin, "herdr"), `#!/bin/sh
case "$1 $2" in
  "workspace list")
    if [ -f ${JSON.stringify(created)} ]; then
      echo '{"result":{"workspaces":[{"workspace_id":"w1","label":"repo@ticket-one"}]}}'
    else echo '{"result":{"workspaces":[]}}'; fi ;;
  "pane list") echo '{"result":{"panes":[{"workspace_id":"w1","pane_id":"w1:p1"}]}}' ;;
  "pane run") printf '%s' "$4" > ${JSON.stringify(commandFile)}; exit "\${FAIL_DISPATCH:-0}" ;;
esac
`);
    await executable(join(fakeBin, "pi"), `#!/bin/sh
[ -z "\${PI_ORCHESTRATION_SESSION_ID+x}" ] || exit 3
[ "$PI_PARENT_ORCHESTRATION_SESSION_ID" = session-123 ] || exit 4
[ "$#" = 1 ] || exit 5
printf '%s' "$1" > ${JSON.stringify(received)}
`);
    const env = {
      ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, TMPDIR: root,
      PI_ORCHESTRATION_SESSION_ID: "session-123", HERDR_ENV: manager === "herdr" ? "1" : "0",
    };
    try {
      // Exercise both context input forms. Run the terminal command only after the
      // spawner exits, as the real pane does during shell startup.
      const result = spawnSync(spawnWorker, manager === "tmux" ? ["ticket-one", "--context", context] : ["ticket-one"], {
        encoding: "utf8", env, input: manager === "herdr" ? context : "",
      });
      assert.equal(result.status, 0, result.stderr);
      const command = await readFile(commandFile, "utf8");
      assert.ok(Buffer.byteLength(command) < 1024, `${manager}: terminal command is ${Buffer.byteLength(command)} bytes`);
      assert.match(command, /^bash \/tmp\/pi-worker\.[A-Za-z0-9]+$/);
      const launcher = command.slice("bash ".length);
      assert.equal((await stat(launcher)).mode & 0o777, 0o600);
      const launched = spawnSync("fish", ["--no-config", "-c", command], { encoding: "utf8", env });
      assert.equal(launched.status, 0, launched.stderr);
      await assert.rejects(stat(launcher), { code: "ENOENT" });
      assert.equal(await readFile(received, "utf8"),
        "/skill:ticket-worker \n\nTicket: ticket-one\nWorker identity: repo@ticket-one\nPR base: main\n\nContext:\n" + context.trim());

      for (const failure of manager === "tmux" ? ["FAIL_DISPATCH", "FAIL_ENTER"] : ["FAIL_DISPATCH"]) {
        await rm(created);
        const failed = spawnSync(spawnWorker, ["ticket-one"], {
          encoding: "utf8", env: { ...env, [failure]: "7" }, input: "",
        });
        assert.equal(failed.status, 7, failed.stderr);
        const failedCommand = await readFile(commandFile, "utf8");
        await assert.rejects(stat(failedCommand.slice("bash ".length)), { code: "ENOENT" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
