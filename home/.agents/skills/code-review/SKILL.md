---
name: code-review
description: Review a code change for proven defects, relevant design risks, and maintainability problems. Use for pull request reviews, change reviews, architecture reviews of a diff, and security reviews of a diff.
---

# Code review

Review the change against its ticket and repository context. Report only findings that pass the evidence and scope gates below. A review with no findings is a complete review.

## Publication boundary

Default to a local review. Report findings in chat.

Publish comments, submit a review, approve, request changes, or otherwise mutate a remote pull request only when the user explicitly asks you to do so. A request to review or re-review does not grant permission to publish.

## Context

Before reviewing:

1. Read the applicable repository instructions and `CONTEXT.md` files.
2. Read the ticket, pull request description, and linked decisions that are available.
3. Identify the required outcome in one sentence.
4. Inspect the complete diff and enough surrounding code to understand each changed path.
5. For a pull request, read available CI results and failure output.

The ticket defines the required outcome. The diff and the behavior it changes define the review scope.

## Execution boundary

Repository verification runs out of band. Assume automated repository checks pass. Do not run tests, lint, formatting, builds, type checks, or other repository verification commands.

Inspect test code when it helps explain a contract or changed path. Execute code only to test a specific hypothesis found during review. Use a focused reproduction for that hypothesis, not the repository's existing test suite. A reproduction supplies review evidence; it does not duplicate CI.

## Finding gate

Report a finding only when all of these statements are true:

1. **Changed:** The change introduces the problem, exposes it, or materially relies on an existing problem.
2. **Concrete:** A reachable input, state, or code path produces a specific harmful result.
3. **Material:** The result affects correctness, security, data integrity, operability, or the required outcome.
4. **Proven:** Repository evidence, a reproduction, a test, or verified dependency evidence supports the claim.
5. **Scoped:** The proposed action is the smallest reasonable correction for this change.

Trace the causal path from the changed line to the harmful result. Reject a candidate finding when a required step in that path is only an assumption.

Do not report speculative hardening, unrelated pre-existing defects, personal preferences, or hypothetical future requirements as findings.

## Dependency evidence

Treat every statement about an external tool, library, framework, service, command, file format, or platform as a dependency claim.

Before a dependency claim becomes a finding:

1. Identify the exact dependency and version used by the change.
2. Verify the claimed behavior in the installed source, upstream source, official documentation, a reproducible experiment, or a credible upstream issue or report.
3. Verify that the changed code reaches that behavior with the inputs and configuration in this repository.
4. Cite the evidence in the finding. Give the source path and symbol, command and observed output, or URL and relevant section.

Memory of how a dependency usually works is not evidence. Similar tools, other versions, and conventional behavior are not evidence for the dependency in use.

When evidence is unavailable or inconclusive, omit the claim from the findings. Do not transfer the uncertainty to the worker as a question, defensive test, fallback, replacement, or reimplementation request.

A dependency replacement or custom implementation is justified only when verified behavior causes an in-scope defect and replacement is the smallest reasonable correction. First check the dependency's supported API, configuration, and version-specific behavior.

Apply this rule especially to claims about parsing, escaping, ordering, retries, concurrency, races, naming collisions, generated identifiers, filesystem behavior, and command-line tools.

## Design findings and suggestions

Review design where the change adds a structural problem or continues a harmful direction in the codebase.

A design comment must identify:

- the changed structure that causes or deepens the problem;
- a concrete maintenance, correctness, or testability cost;
- repository evidence, such as duplicated change points, an existing boundary, or current callers; and
- an improvement proportional to the ticket.

A proven design problem can be a finding. A structure improvement that is useful but not required for the ticket must be labeled `[suggestion]` and must not block the change.

Do not turn a design suggestion into a new feature, broad refactor, dependency replacement, or custom implementation. Do not use a question to disguise an unverified allegation.

## Review procedure

1. State the required outcome and identify the changed execution paths.
2. Try to falsify the change's material behavior, contract, safety, compatibility, rollout, and test claims.
3. Inspect callers, callees, tests, and established repository patterns that are necessary to evaluate those paths.
4. Apply the execution boundary when a candidate concern needs runtime evidence.
5. Research dependency behavior when a candidate concern depends on it.
6. Apply the finding gate to every candidate. Discard candidates that fail any gate.
7. Rank and report the admitted findings.

Use checklists only as search prompts. A checklist item is never evidence and does not create a finding by itself.

## Mocks and test doubles

Evaluate a mock, stub, fake, or spy against the production dependency's externally observable contract:

- accepted arguments;
- returned type and shape;
- synchronous or asynchronous behavior;
- error shape when the code branches on it; and
- required observable side effects.

Verify that contract from the production dependency before reporting a mismatch. Differences in internal implementation are expected and are not findings.

## Severity

- `[blocking]`: The change cannot safely merge because it fails the required outcome or creates a material correctness, security, data-loss, or operability defect.
- `[important]`: A proven, material problem should be corrected, but it does not make the change unsafe to merge.
- `[suggestion]`: A supported structure improvement is useful but optional and in scope.

Severity follows demonstrated impact, not the reviewer's confidence or preference.

## Output

List findings first, ordered by severity. For each finding include:

- severity and concise title;
- exact file and line;
- reachable scenario and concrete impact;
- evidence that proves the causal path;
- citations for each dependency claim; and
- the smallest reasonable correction.

Then give a short verdict: `request changes`, `comment`, or `approve`.

If no candidate passes the finding gate, say that no findings were found and approve. State a review-coverage limitation only when unavailable context prevented review of a required path. Describe the missing context without speculating about defects.
