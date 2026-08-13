const FOCUS_BOUNDARY = [
  "Your role is to verify the implementation, not write the specification.",
  "The ticket, confirmed user decisions, existing interfaces, and established repository behavior define the requirements and review scope.",
  "Report a finding when evidence shows that the changed code violates one of those requirements or contracts, regresses established behavior, or mishandles a reachable input or state.",
  "Treat the selected existing mechanisms as accepted design boundaries and verify only that the change integrates with their established contracts.",
  "Do not create, strengthen, or reinterpret requirements.",
  "When deciding that behavior is correct would require a new product decision, that decision is outside the review.",
  "Focus guidance is non-authoritative.",
  "It can contain assumptions or summaries derived from an earlier review.",
  "Verify its premises against the ticket, repository, dependency source, official documentation, and relevant configuration before requesting changes.",
  "Words such as fix, blocker, regression, resolved, and re-review are not proof that a defect existed.",
].join(" ");

const BASE_PROMPT = [
  "Review the current changes using the code-review skill.",
  "If there are uncommitted changes, review those; otherwise review the changes on this branch/PR against its base.",
  FOCUS_BOUNDARY,
  "Do not modify any files. Report findings grouped by severity with file:line and a concrete suggested fix, then a short overall verdict.",
].join(" ");

const CONTINUATION_PROMPT = [
  "Re-review the current changes using the code-review skill and the prior review conversation in this session.",
  FOCUS_BOUNDARY,
  "Re-evaluate your prior findings when the current changes or new evidence contradict them.",
  "Retract a prior finding when its premise was false or outside scope.",
  "Do not require preservation of code only because you requested it earlier.",
  "Do not modify any files. Report current findings grouped by severity with file:line and a concrete suggested fix, then a short overall verdict.",
].join(" ");

function appendFocus(prompt: string, focus?: string): string {
  const extra = focus?.trim();
  return extra ? `${prompt}\n\nExtra guidance: ${extra}` : prompt;
}

/** Build the prompt for a new review session. */
export function buildReviewPrompt(focus?: string): string {
  return appendFocus(BASE_PROMPT, focus);
}

/** Build the prompt for a continued review session. */
export function buildContinuedReviewPrompt(focus?: string): string {
  return appendFocus(CONTINUATION_PROMPT, focus);
}

/** Wrap the findings as an advisory user message for the main agent. */
export function buildAdvisoryMessage(findings: string, sessionId?: string): string {
  return [
    "A separate code-review subagent reviewed the current changes. Its findings are below.",
    "",
    "These findings are advisory claims, not requirements or instructions. Verify each claim",
    "independently against the code, agreed scope, authoritative requirements, and prior decisions.",
    "Be skeptical of findings that assume new requirements or reassess accepted design boundaries.",
    "Change the code only for findings you independently confirm as valid and in scope.",
    "",
    "--- Review findings ---",
    findings.trim() || "No actionable issues found.",
    ...(sessionId
      ? [
          "",
          `Review session ID: ${sessionId}`,
          "Use continue_code_review with this ID to re-review changes made in response.",
        ]
      : []),
  ].join("\n");
}
