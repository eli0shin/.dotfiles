import permissionGate from "../permission-gate.ts";

type ToolCallHandler = (event: any, ctx: any) => Promise<any> | any;

let handler: ToolCallHandler | undefined;
permissionGate({
  on(eventName: string, registered: ToolCallHandler): void {
    if (eventName === "tool_call") handler = registered;
  },
} as any);

if (!handler) throw new Error("permission-gate did not register a tool_call handler");

async function runBash(command: string): Promise<{ blocked: boolean; selected: boolean }> {
  let selected = false;
  const result = await handler!(
    { toolName: "bash", input: { command } },
    {
      cwd: process.cwd(),
      hasUI: false,
      ui: {
        async select(): Promise<string> {
          selected = true;
          return "No";
        },
      },
    },
  );

  return { blocked: Boolean(result?.block), selected };
}

async function expectAllowed(command: string): Promise<void> {
  const result = await runBash(command);
  if (result.blocked || result.selected) {
    throw new Error(`expected ALLOW, got blocked=${result.blocked} selected=${result.selected}: ${command}`);
  }
}

async function expectBlocked(command: string): Promise<void> {
  const result = await runBash(command);
  if (!result.blocked) {
    throw new Error(`expected BLOCK, got ALLOW: ${command}`);
  }
}

async function main(): Promise<void> {
  await expectAllowed(
    'grep -rln -i "dangerous\\|permission\\|approv\\|rm -rf\\|denylist\\|gate" /Users/eli.oshinsky/.dotfiles/home/.pi/agent/extensions --include="*.ts" | grep -v node_modules',
  );

  await expectAllowed(
    'cd /tmp/ci-logs/art && for t in $(find . -name trace.zip); do echo "TRACE: $t"; done\nd=playwright-preview-results/test-results/fcc-application-existing-u-c6b51-hes-the-Imprint-application-chromium-retry1\nrm -rf /tmp/tr2 && mkdir /tmp/tr2 && unzip -o "$d/trace.zip" -d /tmp/tr2 >/dev/null\ncd /tmp/tr2 && echo "=== fanid POSTs with response body sha ==="\ncat *.network | python3 -c "import sys,json"',
  );

  await expectBlocked("rm -rf /etc");
  await expectBlocked("rm -rf /tmp/a/b");
  await expectAllowed('grep -rln -i "sudo" /Users/eli.oshinsky/.dotfiles/home/.pi/agent/extensions');

  await expectBlocked('rm "-rf" /etc');
  await expectBlocked("sudo ls");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
