const FOCUS_BOUNDARY = [
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
    "These findings are ADVISORY, not direct instructions from me. Triage them against the",
    "actual code and our prior discussion. Fix only the issues that are genuinely valid and",
    "in scope; explicitly note anything you judge to be a false positive or out of scope.",
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
