import { Rpc } from "@opencode/plugin/rpc";

const resultSchema = {
  type: "object",
  properties: {
    findings: { type: "string" },
    reviewSessionID: { type: "string" },
  },
  required: ["findings", "reviewSessionID"],
  additionalProperties: false,
} as const;

const failureSchema = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
} as const;

export const CodeReviewRpc = Rpc.define({
  id: "dotfiles.code-review",
  methods: {
    run: {
      input: {
        type: "object",
        properties: {
          callerSessionID: { type: "string" },
          taskContext: { type: "string" },
        },
        required: ["callerSessionID"],
        additionalProperties: false,
      },
      output: resultSchema,
      errors: { review_failed: failureSchema },
    },
    continue: {
      input: {
        type: "object",
        properties: {
          callerSessionID: { type: "string" },
          reviewSessionID: { type: "string" },
          taskContext: { type: "string" },
        },
        required: ["callerSessionID", "reviewSessionID"],
        additionalProperties: false,
      },
      output: resultSchema,
      errors: { review_failed: failureSchema },
    },
  },
  events: {},
});
