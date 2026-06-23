/**
 * Code Review extension
 *
 * Adds:
 *   - `/code-review` slash command: runs a review subagent against the current
 *     changes, surfaces findings in a UI overlay, and ONLY sends them to the
 *     main agent if the user chooses "Send to agent".
 *   - `run_code_review` tool: lets the main agent review its own changes. The
 *     findings are always returned to the agent as the tool result.
 *
 * The review runs as an isolated in-process pi session via the SDK (the
 * equivalent of `pi -p "review the current changes"`), uses the
 * code-review skill, and provides a review of the code changes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildAdvisoryMessage, buildReviewPrompt } from "./code-review-message.ts";
import { isReviewFailure, runReview } from "./code-review-runner.ts";
import { presentReview } from "./code-review-ui.ts";
import type { ReviewResult } from "./types.ts";

export default function (pi: ExtensionAPI) {
  // -------- /code-review command --------
  pi.registerCommand("code-review", {
    description: "Review the current changes; choose whether to send the findings to the agent",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/code-review requires interactive mode", "error");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Waiting for the current turn to finish before reviewing…", "info");
        await ctx.waitForIdle();
      }

      const prompt = buildReviewPrompt(args);

      // Run inside a modal loader: shows a spinner, captures input (Esc cancels),
      // and never silently swallows typed messages.
      const result = await ctx.ui.custom<ReviewResult | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, "Reviewing current changes…");
        loader.onAbort = () => done(null);
        runReview(prompt, ctx.cwd, {
          signal: loader.signal,
          model: ctx.model,
          thinkingLevel: pi.getThinkingLevel(),
        })
          .then(done)
          .catch((error) =>
            done({
              output: "",
              aborted: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return loader;
      });

      if (result === null || result.aborted) {
        ctx.ui.notify("Review cancelled.", "info");
        return;
      }
      if (isReviewFailure(result)) {
        ctx.ui.notify(`Review failed: ${result.error || "no output"}`, "error");
        return;
      }

      const action = await presentReview(ctx, result.output);
      if (action === "send") {
        pi.sendUserMessage(buildAdvisoryMessage(result.output));
        ctx.ui.notify("Review findings sent to the agent.", "info");
      } else if (action === "save") {
        const file = path.join(os.tmpdir(), `pi-code-review-${Date.now()}.md`);
        fs.writeFileSync(file, `# Code Review\n\n${result.output}\n`, "utf8");
        ctx.ui.notify(`Review saved to ${file}`, "info");
      } else {
        ctx.ui.notify("Review ignored.", "info");
      }
    },
  });

  // -------- run_code_review tool --------
  pi.registerTool({
    name: "run_code_review",
    label: "Run Code Review",
    description: [
      "Run a code-review subagent against the current changes and return its findings.",
      "The subagent uses the code-review skill and provides a review of the code changes.",
      "Use this after completing non-trivial code changes to self-review before finishing.",
    ].join(" "),
    promptSnippet: "Run a code review of the current changes and return findings",
    promptGuidelines: [
      "Use run_code_review after completing non-trivial code changes, before your final response, unless the change is documentation-only, trivial, or the user asked you not to.",
      "Treat run_code_review findings as advisory: verify each against the code and address only valid, in-scope issues.",
    ],
    parameters: Type.Object({
      focus: Type.Optional(Type.String({ description: "Optional extra guidance to focus the review" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reviewing current changes…" }], details: {} });
      const result = await runReview(buildReviewPrompt(params.focus), ctx.cwd, {
        signal,
        model: ctx.model,
        thinkingLevel: pi.getThinkingLevel(),
      });
      if (isReviewFailure(result)) {
        throw new Error(`Review failed: ${result.error || "no output"}`);
      }
      return {
        content: [{ type: "text", text: result.output || "No actionable issues found." }],
        details: { findings: result.output },
      };
    },
  });
}
