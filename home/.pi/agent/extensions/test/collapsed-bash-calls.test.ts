import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { collapseBashCall, collapseCommand } from "../collapsed-bash-calls.ts";

// keyHint reads the global theme.
initTheme();

const heredoc = ["python3 - <<'PY'", "p='a.ts'", "s=open(p).read()", "s=s.replace('a','b')", "open(p,'w').write(s)", "PY"].join(
  "\n",
);

const theme = { fg: (_color: string, text: string) => text };

function renderedCommand(command: string, expanded: boolean): string {
  let seen: string | undefined;
  const renderers = collapseBashCall({
    renderCall(args) {
      seen = (args as { command: string }).command;
      return { render: () => [], invalidate: () => {} };
    },
  });
  renderers?.renderCall?.({ command }, theme as never, { expanded } as never);
  assert.ok(seen !== undefined);
  return seen;
}

test("keeps short commands whole", () => {
  assert.equal(collapseCommand("git status"), undefined);
  assert.equal(collapseCommand("a\nb\nc\nd"), undefined);
  assert.equal(collapseCommand("a\nb\nc\nd\n\n"), undefined);
  assert.equal(collapseCommand(undefined), undefined);
});

test("previews the first lines of a long command", () => {
  assert.deepEqual(collapseCommand(heredoc), {
    preview: "python3 - <<'PY'\np='a.ts'\ns=open(p).read()",
    hiddenLines: 3,
  });
});

test("collapses a long call only while the row is collapsed", () => {
  const collapsed = renderedCommand(heredoc, false);
  assert.match(collapsed, /^python3 - <<'PY'\np='a\.ts'\ns=open\(p\)\.read\(\)\n\.\.\. \(3 more lines, .*to expand.*\)$/s);
  assert.equal(renderedCommand(heredoc, true), heredoc);
  assert.equal(renderedCommand("git status", false), "git status");
});

test("passes through tools without a call renderer", () => {
  assert.equal(collapseBashCall(undefined), undefined);
  const renderers = { renderShell: "self" as const };
  assert.equal(collapseBashCall(renderers), renderers);
});
