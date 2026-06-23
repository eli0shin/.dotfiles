const BASE_PROMPT = [
  "Review the current changes using the code-review skill.",
  "If there are uncommitted changes, review those; otherwise review the changes on this branch/PR against its base.",
  "Do not modify any files. Report findings grouped by severity with file:line and a concrete suggested fix, then a short overall verdict.",
].join(" ");


/** Build the prompt sent to the review subagent. */
export function buildReviewPrompt(focus?: string): string {
  const extra = focus?.trim();
  return extra ? `${BASE_PROMPT}\n\nExtra guidance: ${extra}` : BASE_PROMPT;
}

/** Wrap the findings as an advisory user message for the main agent. */
export function buildAdvisoryMessage(findings: string): string {
  return [
    "A separate code-review subagent reviewed the current changes. Its findings are below.",
    "",
    "These findings are ADVISORY, not direct instructions from me. Triage them against the",
    "actual code and our prior discussion. Fix only the issues that are genuinely valid and",
    "in scope; explicitly note anything you judge to be a false positive or out of scope.",
    "",
    "--- Review findings ---",
    findings.trim() || "No actionable issues found.",
  ].join("\n");
}
