import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { generateSyntax } from "@opencode/theme/tui";

import { buildAdvisoryMessage } from "../lib/code-review.ts";
import { CodeReviewRpc } from "./code-review/rpc.ts";

type ReviewAction = "send" | "save" | "ignore";
type ReviewResult = { findings: string; reviewSessionID: string };

function reviewResult(value: unknown): ReviewResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("findings" in value) ||
    typeof value.findings !== "string" ||
    !("reviewSessionID" in value) ||
    typeof value.reviewSessionID !== "string"
  ) {
    throw new Error("Code review returned an invalid result");
  }
  return { findings: value.findings, reviewSessionID: value.reviewSessionID };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
  return String(error);
}

function presentReview(ctx: Context, findings: string): Promise<ReviewAction> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (action: ReviewAction) => {
      if (settled) return;
      settled = true;
      ctx.ui.dialog.clear();
      resolve(action);
    };

    ctx.ui.dialog.show(
      () => (
        <box flexDirection="column" height={Math.max(12, Math.min(40, ctx.renderer.height - 6))} gap={1}>
          <text fg={ctx.theme.text.default}>Code Review</text>
          <scrollbox flexGrow={1}>
            <markdown
              content={findings.trim() || "No actionable issues found."}
              syntaxStyle={generateSyntax(ctx.theme.contextual.overlay, ctx.themeMode)}
              fg={ctx.theme.text.default}
              conceal
            />
          </scrollbox>
          <select
            focused
            height={6}
            options={[
              { name: "Send to agent", description: "Inject findings as advisory context", value: "send" },
              { name: "Save to file", description: "Write findings to a markdown file", value: "save" },
              { name: "Ignore", description: "Discard the review", value: "ignore" },
            ]}
            onSelect={(_index, option) => {
              if (option) finish(option.value as ReviewAction);
            }}
          />
          <text fg={ctx.theme.text.subdued}>↑↓ navigate • enter select • esc ignore</text>
        </box>
      ),
      () => {
        if (settled) return;
        settled = true;
        resolve("ignore");
      },
    );
    ctx.ui.dialog.set({ size: "xlarge", centered: true });
  });
}

export default Plugin.define({
  id: "dotfiles.code-review-tui",
  setup: (ctx) => {
    const review = ctx.client.rpc(CodeReviewRpc);

    async function runCodeReview(input = ""): Promise<void> {
      const route = ctx.ui.router.current();
      if (route.type !== "session") {
        ctx.ui.toast.show({ message: "Open a session before you use /code-review.", variant: "warning" });
        return;
      }

      await ctx.client.session.wait({ sessionID: route.sessionID });
      const controller = new AbortController();
      let running = true;
      ctx.ui.dialog.show(
        () => (
          <box flexDirection="column" gap={1}>
            <text fg={ctx.theme.text.status.running}>Reviewing current changes…</text>
            <text fg={ctx.theme.text.subdued}>Press esc to cancel</text>
          </box>
        ),
        () => {
          if (running) controller.abort();
        },
      );
      ctx.ui.dialog.set({ size: "medium", centered: true });

      let result: ReviewResult;
      try {
        const session = ctx.data.session.get(route.sessionID);
        const location = session?.location ?? ctx.location;
        result = reviewResult(await review.run(
          {
            callerSessionID: route.sessionID,
            taskContext: input.trim() || undefined,
          },
          {
            signal: controller.signal,
            location: location
              ? { directory: location.directory, workspace: location.workspaceID }
              : undefined,
          },
        ));
      } catch (error) {
        running = false;
        ctx.ui.dialog.clear();
        ctx.ui.toast.show(
          controller.signal.aborted
            ? { title: "Code review", message: "Review cancelled.", variant: "info" }
            : { title: "Code review", message: `Review failed: ${errorMessage(error)}`, variant: "error" },
        );
        return;
      }
      running = false;
      ctx.ui.dialog.clear();

      const action = await presentReview(ctx, result.findings);
      if (action === "send") {
        await ctx.client.session.prompt({
          sessionID: route.sessionID,
          text: buildAdvisoryMessage(result.findings, result.reviewSessionID),
          delivery: "steer",
        });
        ctx.ui.toast.show({ title: "Code review", message: "Review findings sent to the agent.", variant: "info" });
        return;
      }
      if (action === "save") {
        const file = join(tmpdir(), `opencode-code-review-${Date.now()}.md`);
        await writeFile(
          file,
          `# Code Review\n\n${result.findings}\n\nReview session ID: ${result.reviewSessionID}\n`,
          "utf8",
        );
        ctx.ui.toast.show({ title: "Code review", message: `Review saved to ${file}`, variant: "info" });
        return;
      }
      ctx.ui.toast.show({ title: "Code review", message: "Review ignored.", variant: "info" });
    }

    return ctx.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "code-review.command",
            title: "Code review",
            description: "Review current changes and choose whether to send the findings to the agent",
            slash: { name: "code-review", arguments: true },
            palette: true,
            run: runCodeReview,
          }],
        }));
        return null;
      },
    });
  },
});
