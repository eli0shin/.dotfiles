import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCommand } from "../permission-gate.ts";

const TEST_SETTINGS = {
  askCommands: ["rm", "sudo"],
  rmPolicy: {
    allowGitRepositories: true,
    allowTempDirectories: true,
    blockHome: true,
    blockRecursiveOutsideAllowedLocations: true,
  },
};

async function runBash(
  command: string,
  options: { cwd?: string; hasUI?: boolean } = {},
): Promise<{ blocked: boolean; reason?: string; selected: boolean }> {
  const result = inspectCommand(command, options.cwd ?? process.cwd(), TEST_SETTINGS, []);
  if (result.blockedByRmPolicy) {
    return { blocked: true, reason: "rm blocked by permissionGate.bash.rmPolicy", selected: false };
  }
  if (!result.needsAsk) return { blocked: false, selected: false };
  if (!options.hasUI) {
    return { blocked: true, reason: "Dangerous command blocked without interactive confirmation", selected: false };
  }
  return { blocked: true, reason: "Blocked by user", selected: true };
}

async function expectAllowed(command: string, cwd?: string): Promise<void> {
  const result = await runBash(command, { cwd, hasUI: true });
  if (result.blocked || result.selected) {
    throw new Error(`expected ALLOW, got ${JSON.stringify(result)}: ${command}`);
  }
}

async function expectPolicyBlocked(command: string, cwd?: string): Promise<void> {
  const result = await runBash(command, { cwd, hasUI: true });
  if (!result.blocked || result.selected || result.reason !== "rm blocked by permissionGate.bash.rmPolicy") {
    throw new Error(`expected POLICY BLOCK, got ${JSON.stringify(result)}: ${command}`);
  }
}

async function expectAsked(command: string, cwd?: string): Promise<void> {
  const result = await runBash(command, { cwd, hasUI: true });
  if (!result.blocked || !result.selected || result.reason !== "Blocked by user") {
    throw new Error(`expected ASK, got ${JSON.stringify(result)}: ${command}`);
  }
}

async function main(): Promise<void> {
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const tempRoot = tmpdir();
  const symlinkFixture = mkdtempSync(join(tempRoot, "pi-gate-test-"));
  const rootLink = join(symlinkFixture, "root-link");
  symlinkSync("/", rootLink);

  await expectAllowed(
    'grep -rln -i "dangerous\\|permission\\|approv\\|rm -rf\\|denylist\\|gate" . --include="*.ts" | grep -v node_modules',
  );
  await expectAllowed('grep -rln -i "sudo" .');

  // Any target in or equal to a Git repository is allowed, including metadata.
  await expectAllowed("rm tracked-source.ts", gitRoot);
  await expectAllowed("rm -rf src/generated", gitRoot);
  await expectAllowed(`rm -rf "${gitRoot}"`);
  await expectAllowed(`rm -rf "${join(gitRoot, ".git")}"`);
  await expectAllowed("rm -rf ./*", gitRoot);

  // Any descendant of a recognized temporary directory is allowed.
  await expectAllowed(`rm -rf "${join(tempRoot, "pi-gate", "nested")}"`);
  await expectAllowed("cd /tmp && rm -rf nested/path");
  await expectAllowed("true && cd /tmp && rm -rf nested/path", "/etc");
  await expectAllowed("rm -rf /tmp/*");
  await expectAllowed('tmp=$(mktemp); rm "$tmp"');
  await expectAllowed('  tmp=$(mktemp); rm "$tmp"');
  await expectAllowed('tmp=$(mktemp -d); rm -rf "$tmp"');
  await expectAllowed('tmp=$(mktemp -d); rm -rf "$tmp/nested"');
  await expectAllowed(`rm -rf "${rootLink}"`);

  // Home and filesystem root are always blocked as direct targets.
  await expectPolicyBlocked(`rm "${homedir()}"`);
  await expectPolicyBlocked("rm -rf ~/");
  await expectPolicyBlocked('rm -rf "$HOME"');
  await expectPolicyBlocked("rm -rf /");

  // Recursive removal elsewhere is blocked; non-recursive removal asks.
  await expectPolicyBlocked("rm -rf /etc");
  await expectPolicyBlocked('"rm" -rf /etc');
  await expectPolicyBlocked("/bin/rm -rf /etc");
  await expectPolicyBlocked("command rm -rf /etc");
  await expectPolicyBlocked("env rm -rf /etc");
  await expectPolicyBlocked("exec rm -rf /etc");
  await expectPolicyBlocked("sudo rm -rf /etc");
  await expectPolicyBlocked("rm -rf $(printf /etc)");
  await expectPolicyBlocked("rm -rf `printf /etc`");
  await expectPolicyBlocked('echo "$(rm -rf /etc)"');
  await expectPolicyBlocked('sh -c "rm -rf /etc"');
  await expectPolicyBlocked('env sh -c "rm -rf /etc"');
  await expectPolicyBlocked('nohup bash -lc "rm -rf /etc"');
  await expectPolicyBlocked('eval "rm -rf /etc"');
  await expectPolicyBlocked("if true; then rm -rf /etc; fi");
  await expectPolicyBlocked("{ rm -rf /etc; }");
  await expectPolicyBlocked("X=1 rm -rf /etc");
  await expectPolicyBlocked("! rm -rf /etc");
  await expectPolicyBlocked("cd /etc && rm -rf pi-gate-file");
  await expectPolicyBlocked("false && cd /tmp; rm -rf pi-gate-file", "/etc");
  await expectPolicyBlocked("true && cd /etc && rm -rf pi-gate-file", gitRoot);
  await expectPolicyBlocked("(cd /etc; rm -rf pi-gate-file)", gitRoot);
  await expectPolicyBlocked("(cd /tmp); rm -rf pi-gate-file", "/etc");
  await expectPolicyBlocked("(cd /tmp && true); rm -rf pi-gate-file", "/etc");
  await expectPolicyBlocked('tmp=$(mktemp -d); tmp=/etc; rm -rf "$tmp"');
  await expectPolicyBlocked('tmp=$(mktemp /var/tmp/pi.XXXXXX); rm -rf "$tmp"');
  await expectPolicyBlocked('readonly tmp=/etc; tmp=$(mktemp); rm -rf "$tmp"');
  await expectPolicyBlocked('TMPDIR=/etc; tmp=$(mktemp -d); rm -rf "$tmp"');
  await expectPolicyBlocked('tmp=$(mktemp -d); export tmp=/etc; rm -rf "$tmp"');
  await expectPolicyBlocked('rm -rf "$unknown_path"');
  await expectPolicyBlocked("rm -rf '$TMPDIR/pi-safe'", "/etc");
  await expectPolicyBlocked("rm -rf \\$TMPDIR/pi-safe", "/etc");
  await expectPolicyBlocked("rm -rf /tmp/*/../../etc");
  await expectPolicyBlocked("rm -rf /tmp/*/etc");
  await expectPolicyBlocked(`rm -rf "${rootLink}/etc/passwd"`);
  await expectPolicyBlocked(`rm -rf "${rootLink}/etc/*"`);
  await expectPolicyBlocked('opts=-rf; rm $opts /etc');
  await expectPolicyBlocked("rm --recursiv? /etc");
  await expectPolicyBlocked("printf '/etc\\0' | xargs -0 rm -rf", "/etc");
  await expectPolicyBlocked(`rm -rf "${join(tempRoot, "safe")}" /etc`);
  await expectAsked("rm /etc/pi-gate-file");
  await expectAsked("sudo ls");

  // Quoting an option does not change rm's interpretation of it.
  await expectPolicyBlocked('rm "-rf" /etc');
  rmSync(symlinkFixture, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
