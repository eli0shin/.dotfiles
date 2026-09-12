import { Plugin } from "@opencode/plugin";

import {
  buildAdvisoryMessage,
  CODE_REVIEW_TOOLS,
  CODE_REVIEWER_AGENT,
  createCodeReviewRunner,
} from "../../lib/code-review.ts";
import { CodeReviewRpc } from "./rpc.ts";

const TASK_CONTEXT_DESCRIPTION = [
  "Context for the task that the code change must implement.",
  "Include the original request, ticket key, requirements, acceptance criteria, and constraints when available.",
  "This input describes the task; the reviewer determines what to inspect.",
  "Use only known task details.",
].join(" ");

const taskContextInput = {
  type: "object",
  properties: {
    taskContext: { type: "string", description: TASK_CONTEXT_DESCRIPTION },
  },
  additionalProperties: false,
} as const;

function taskContext(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("taskContext" in input)) return undefined;
  return typeof input.taskContext === "string" ? input.taskContext : undefined;
}

function reviewSessionID(input: unknown): string {
  if (typeof input !== "object" || input === null || !("reviewSessionID" in input)) return "";
  return typeof input.reviewSessionID === "string" ? input.reviewSessionID : "";
}

function rpcInput(input: unknown): {
  callerSessionID: string;
  taskContext?: string;
  reviewSessionID?: string;
} {
  const value = input as Record<string, unknown>;
  return {
    callerSessionID: typeof value.callerSessionID === "string" ? value.callerSessionID : "",
    taskContext: typeof value.taskContext === "string" ? value.taskContext : undefined,
    reviewSessionID: typeof value.reviewSessionID === "string" ? value.reviewSessionID : undefined,
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default Plugin.define({
  id: "dotfiles.code-review",
  setup: async (ctx) => {
    const runner = createCodeReviewRunner({ session: ctx.session });
    const registrations: Array<{ dispose(): Promise<void> }> = [];

    registrations.push(await ctx.session.hook("context", (event) => {
      if (event.agent !== CODE_REVIEWER_AGENT) return;
      for (const tool of Object.keys(event.tools)) {
        if (!CODE_REVIEW_TOOLS.has(tool)) delete event.tools[tool];
      }
    }));

    registrations.push(await ctx.tool.transform((editor) => {
      editor.add({
        name: "run_code_review",
        description: [
          "Run a code-review subagent against the current changes and return its findings.",
          "The subagent uses the code-review skill and provides a review of the code changes.",
          "Use this after completing non-trivial code changes to self-review before finishing.",
          "Treat findings as advisory and independently verify each one.",
        ].join(" "),
        input: taskContextInput,
        options: { codemode: false },
        execute: async (input, tool) => {
          if (tool.agent === CODE_REVIEWER_AGENT) {
            throw new Error("The reviewer cannot start or continue code reviews");
          }
          await tool.progress({ status: "Reviewing current changes…" });
          const result = await runner.run(tool.sessionID, taskContext(input));
          return {
            content: [{ type: "text", text: buildAdvisoryMessage(result.findings, result.reviewSessionID) }],
            metadata: result,
          };
        },
      });

      editor.add({
        name: "continue_code_review",
        description: [
          "Continue a prior code-review subagent session to re-review current changes.",
          "Use the exact full review session ID returned by run_code_review.",
          "The reviewer retains its prior research, tool calls, and findings.",
          "Treat findings as advisory and independently verify each one.",
        ].join(" "),
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            reviewSessionID: {
              type: "string",
              description: "Exact full review session ID returned by run_code_review",
            },
            taskContext: { type: "string", description: TASK_CONTEXT_DESCRIPTION },
          },
          required: ["reviewSessionID"],
          additionalProperties: false,
        },
        execute: async (input, tool) => {
          if (tool.agent === CODE_REVIEWER_AGENT) {
            throw new Error("The reviewer cannot start or continue code reviews");
          }
          await tool.progress({ status: "Continuing code review…" });
          const result = await runner.continue(
            tool.sessionID,
            reviewSessionID(input),
            taskContext(input),
          );
          return {
            content: [{ type: "text", text: buildAdvisoryMessage(result.findings, result.reviewSessionID) }],
            metadata: result,
          };
        },
      });
    }));

    registrations.push(await ctx.rpc.register(CodeReviewRpc, {
      run: async (input, rpc) => {
        const value = rpcInput(input);
        try {
          return await runner.run(value.callerSessionID, value.taskContext, rpc.signal);
        } catch (error) {
          const message = failureMessage(error);
          return rpc.error("review_failed", message, { message });
        }
      },
      continue: async (input, rpc) => {
        const value = rpcInput(input);
        try {
          return await runner.continue(
            value.callerSessionID,
            value.reviewSessionID ?? "",
            value.taskContext,
            rpc.signal,
          );
        } catch (error) {
          const message = failureMessage(error);
          return rpc.error("review_failed", message, { message });
        }
      },
    }));

    return async () => {
      await Promise.all(registrations.map((registration) => registration.dispose()));
    };
  },
});
