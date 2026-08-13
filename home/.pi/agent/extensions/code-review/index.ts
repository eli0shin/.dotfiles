/**
 * Code Review extension
 *
 * Adds:
 *   - `/code-review` slash command: runs a review subagent against the current
 *     changes, surfaces findings in a UI overlay, and ONLY sends them to the
 *     main agent if the user chooses "Send to agent".
 *   - `run_code_review` tool: starts a review and returns findings plus its
 *     persistent review session ID.
 *   - `continue_code_review` tool: reuses that review session for a re-review.
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
import {
  buildAdvisoryMessage,
  buildContinuedReviewPrompt,
  buildReviewPrompt,
} from "./code-review-message.ts";
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
              sessionId: "",
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
        pi.sendUserMessage(buildAdvisoryMessage(result.output, result.sessionId));
        ctx.ui.notify("Review findings sent to the agent.", "info");
      } else if (action === "save") {
        const file = path.join(os.tmpdir(), `pi-code-review-${Date.now()}.md`);
        fs.writeFileSync(
          file,
          `# Code Review\n\n${result.output}\n\nReview session ID: ${result.sessionId}\n`,
          "utf8",
        );
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
        content: [
          {
            type: "text",
            text: buildAdvisoryMessage(result.output, result.sessionId),
          },
        ],
        details: {
          findings: result.output,
          reviewSessionId: result.sessionId,
          reviewSessionFile: result.sessionFile,
        },
      };
    },
  });

  // -------- continue_code_review tool --------
  pi.registerTool({
    name: "continue_code_review",
    label: "Continue Code Review",
    description: [
      "Continue a prior code-review subagent session to re-review current changes.",
      "Use the full review session ID returned by run_code_review.",
      "The reviewer retains its prior research, tool calls, and findings.",
    ].join(" "),
    promptSnippet: "Continue a prior code review by its full review session ID",
    promptGuidelines: [
      "Use continue_code_review only when re-reviewing changes made in response to a prior run_code_review result.",
      "Pass the exact full review session ID returned by run_code_review; never guess or select the latest review.",
      "Treat continued review findings as advisory: verify each against the code and address only valid, in-scope issues.",
    ],
    parameters: Type.Object({
      reviewSessionId: Type.String({
        description: "Exact full review session ID returned by run_code_review",
      }),
      focus: Type.Optional(Type.String({ description: "Optional non-authoritative review focus" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Continuing code review…" }], details: {} });
      const result = await runReview(buildContinuedReviewPrompt(params.focus), ctx.cwd, {
        signal,
        model: ctx.model,
        thinkingLevel: pi.getThinkingLevel(),
        sessionId: params.reviewSessionId,
      });
      if (isReviewFailure(result)) {
        throw new Error(`Review failed: ${result.error || "no output"}`);
      }
      return {
        content: [
          {
            type: "text",
            text: buildAdvisoryMessage(result.output, result.sessionId),
          },
        ],
        details: {
          findings: result.output,
          reviewSessionId: result.sessionId,
          reviewSessionFile: result.sessionFile,
        },
      };
    },
  });
}
