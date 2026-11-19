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
 * Reviews run on the "review" role's default model from roles.json, or the
 * caller's model without one. `run_code_review` accepts an eligible model name
 * as an override; a continued review keeps the model it started with.
 *
 * The review runs as an isolated in-process pi session via the SDK (the
 * equivalent of `pi -p "review the current changes"`), uses the
 * code-review skill, and provides a review of the code changes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  buildAdvisoryMessage,
  buildContinuedReviewPrompt,
  buildReviewPrompt,
} from "./code-review-message.ts";
import { isReviewFailure, reviewSessionModel, runReview } from "./code-review-runner.ts";
import { presentReview } from "./code-review-ui.ts";
import { eligibleModels, modelName, readRoles, resolveRoleModel } from "./role-models.ts";
import type { ReviewResult } from "./types.ts";

const TASK_CONTEXT_DESCRIPTION = [
  "Context for the task that the code change must implement.",
  "Include the original request, ticket key, requirements, acceptance criteria, and constraints when available.",
  "This input describes the task; the reviewer determines what to inspect.",
  "Use only known task details.",
].join(" ");

function modelDescription(): string {
  const description = [
    "Reviewer model name without its provider, such as gpt-6.2-astra.",
    "Omit it to use the configured review model.",
    "Set it only when the user explicitly asks for a reviewer model.",
  ];
  try {
    const names = eligibleModels(readRoles(), "review").map(modelName);
    if (names.length) description.push(`Eligible: ${names.join(", ")}.`);
  } catch {
    // run_code_review reports an invalid roles.json when it is called.
  }
  return description.join(" ");
}

function findModel(registry: ModelRegistry, provider: string, modelId: string) {
  const model = registry.find(provider, modelId);
  if (!model) throw new Error(`Review model ${provider}/${modelId} is not available`);
  return model;
}

/** The eligible review model the name selects, else the review default, else the caller's model. */
function reviewModel(ctx: ExtensionContext, name?: string) {
  const id = resolveRoleModel(readRoles(), "review", name);
  if (!id) return ctx.model;
  const slash = id.indexOf("/");
  if (slash === -1) throw new Error(`Review model ${id} must be a provider/model ID`);
  return findModel(ctx.modelRegistry, id.slice(0, slash), id.slice(slash + 1));
}

function prepareTaskContextArguments<T>(args: unknown): T {
  if (!args || typeof args !== "object") return args as T;

  const input = args as Record<string, unknown>;
  if (typeof input.focus !== "string" || input.taskContext !== undefined) return args as T;

  const { focus, ...rest } = input;
  return { ...rest, taskContext: focus } as T;
}

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
        Promise.resolve()
          .then(() =>
            runReview(prompt, ctx.cwd, {
              signal: loader.signal,
              model: reviewModel(ctx),
              thinkingLevel: pi.getThinkingLevel(),
            }),
          )
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
        pi.sendUserMessage(buildAdvisoryMessage(result.output, result.sessionId, result.model));
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
      "It reviews with the configured review model unless `model` names another eligible model.",
    ].join(" "),
    promptSnippet: "Run a code review of the current changes and return findings",
    promptGuidelines: [
      "Use run_code_review after completing non-trivial code changes, before your final response, unless the change is documentation-only, trivial, or the user asked you not to.",
      "Treat run_code_review findings as advisory: verify each against the code and address only valid, in-scope issues.",
      "Omit run_code_review's model to use the configured review model; set it only when the user explicitly asks for a reviewer model.",
      "For reviews from several models, call run_code_review once per model in the same response so the reviews run in parallel.",
    ],
    parameters: Type.Object({
      taskContext: Type.Optional(Type.String({ description: TASK_CONTEXT_DESCRIPTION })),
      model: Type.Optional(Type.String({ description: modelDescription() })),
    }),
    prepareArguments: prepareTaskContextArguments,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const model = reviewModel(ctx, params.model);
      const reviewer = model ? ` with ${model.id}` : "";
      onUpdate?.({ content: [{ type: "text", text: `Reviewing current changes${reviewer}…` }], details: {} });
      const result = await runReview(buildReviewPrompt(params.taskContext), ctx.cwd, {
        signal,
        model,
        thinkingLevel: pi.getThinkingLevel(),
      });
      if (isReviewFailure(result)) {
        throw new Error(`Review failed: ${result.error || "no output"}`);
      }
      return {
        content: [
          {
            type: "text",
            text: buildAdvisoryMessage(result.output, result.sessionId, result.model),
          },
        ],
        details: {
          findings: result.output,
          reviewSessionId: result.sessionId,
          reviewSessionFile: result.sessionFile,
          reviewModel: result.model,
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
      "The reviewer retains its prior research, tool calls, and findings, and keeps the model it started with.",
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
      taskContext: Type.Optional(Type.String({ description: TASK_CONTEXT_DESCRIPTION })),
    }),
    prepareArguments: prepareTaskContextArguments,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Continuing code review…" }], details: {} });
      const stored = await reviewSessionModel(params.reviewSessionId, ctx.cwd);
      const result = await runReview(buildContinuedReviewPrompt(params.taskContext), ctx.cwd, {
        signal,
        model: stored ? findModel(ctx.modelRegistry, stored.provider, stored.modelId) : ctx.model,
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
            text: buildAdvisoryMessage(result.output, result.sessionId, result.model),
          },
        ],
        details: {
          findings: result.output,
          reviewSessionId: result.sessionId,
          reviewSessionFile: result.sessionFile,
          reviewModel: result.model,
        },
      };
    },
  });
}
