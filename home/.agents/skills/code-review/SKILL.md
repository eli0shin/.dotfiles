---
name: code-review
description: Review a code change for proven defects, relevant design risks, and maintainability problems. Use for pull request reviews, change reviews, architecture reviews of a diff, and security reviews of a diff.
---

# Code review

Review the change against its ticket and repository context. A review judges two things: whether the change should exist in this shape (direction), and whether it works (defects). Report only findings that pass the gates below. A review with no findings is a complete review.

## Publication boundary

Default to a local review. Report findings in chat.

Publish comments, submit a review, approve, request changes, or otherwise mutate a remote pull request only when the user explicitly asks you to do so. A request to review or re-review does not grant permission to publish.

## Context

Before reviewing:

1. Read:
    - The ticket if available, including its comments: decisions often land there rather than in the description. For Jira, `acli jira workitem view <KEY> --fields summary,description,comment --json`.
    - The ticket's origin: the incident, alert, scan finding, failing test, Slack thread, or earlier ticket that produced it.
    - Pull request description if available.
    - Linked decisions if available.
    - Linked PRs.
    - Linked documentation.
    - Linked slack threads.
    - Earlier reviews and review threads on the pull request, yours and others'.
    - `git log` for the changed files, and the earlier PRs that touched the same behavior.
2. Identify the required outcome in one sentence.
3. Inspect the complete diff and enough surrounding code to understand each changed path.
4. For a pull request, available CI results and failure output.

The ticket states the required outcome; its origin states the problem. When the ticket can't be read, say so at the top of the review: Direction then rests on the description alone.

## Execution boundary

Repository verification runs out of band. Assume automated repository checks pass. Do not run tests, lint, formatting, builds, type checks, or other repository verification commands.

Inspect test code when it helps explain a contract or changed path. Execute code only to test a specific hypothesis found during review. Use a focused reproduction for that hypothesis, not the repository's existing test suite. A reproduction supplies review evidence; it does not duplicate CI.

## Direction

Judge whether the change should exist in this shape before reading it line by line. Each question is answered from evidence the repository already holds:

- **Problem**: confirm the change solves the problem its origin describes. A change aimed at a symptom is an **XY problem**: production behavior altered so a test passes, a scan finding fixed where the system isn't exposed, a guard added where the producer of the bad state should change.
- **Lineage**: when the change retunes an earlier fix of the same problem (a new constant, a longer timer, a flag, a guard for the last fix's edge case), it is a **band-aid** on that fix. Judge the original approach, not the retune. On a re-review, an approach an earlier review rejected stays rejected however many of its gaps the new commits close.
- **Proportion**: weigh the size of the change against the size of the problem. Look for an existing capability that already does the job (an established library, a framework feature, a lint rule, a service or bot, an existing deploy or test path) and for the shape with less state, fewer steps, and fewer paths. Each added state, check, timer, and path is risk the change has to earn.
- **Accommodation**: a change that bends shared structure to fit one new dependency (widened CI triggers, cache inputs, build or lint config, a package boundary) or departs from a convention the repository otherwise follows. Question the dependency or the departure before judging how well the accommodation is done.
- **Placement**: each responsibility sits where the system puts it. A check returns a verdict and writes nothing. Validation runs at the edges, and code inside trusts the narrowed types. Analysis derived from emitted facts lives in the observability stack. A domain term, entity, or operation matches the domain model.
- **Chesterton's fence**: for each behavior the change removes, find why it was added (`git log -S`, blame, the PR that added it) before accepting the removal.
- **Drive-by**: match every hunk to the required outcome. A hunk the outcome doesn't need is a drive-by: a reworded comment, a doc edit, a rename, a reformatted table, a test fixture changed so the new code passes rather than to assert what it does.

A trade-off the change documents is a claim to test, not a reason to accept the design.

Direction is complete when you can state the origin problem, the lineage (or that there is none), the smaller shape you weighed, the reason behind every removed behavior, and which hunks are drive-by.

## Finding gate

A **direction finding** passes when it names the structure or approach at fault, cites the evidence that shows it (the origin, the history, the existing capability, the boundary or convention it crosses, the hunks the outcome doesn't need), and states the shape that fits. That shape can be a different approach or closing the pull request; it is the right shape, not the smallest edit to the current one.

A **defect finding** passes only when all of these statements are true:

1. **Changed:** The change introduces the problem, exposes it, or materially relies on an existing problem.
2. **Concrete:** A reachable input, state, or code path produces a specific harmful result.
3. **Material:** The result affects correctness, security, data integrity, operability, the required outcome, or a repository coding standard.
4. **Proven:** Repository evidence, a reproduction, a test, or verified dependency evidence supports the claim.
5. **Scoped:** The proposed action is the smallest reasonable correction for this change.

For all potential defect findings, trace the causal path from the changed line to the harmful result. Reject a candidate finding when a required step in that path is only an assumption. Do not reject a potential finding until the entire causal path has been traced.

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

Replacing a dependency the change uses with another one or with custom code is justified only when verified behavior causes an in-scope defect and replacement is the smallest reasonable correction. First check the dependency's supported API, configuration, and version-specific behavior. Replacing hand-rolled code with an established dependency or an existing capability is a proportion finding.

Apply this rule especially to claims about parsing, escaping, ordering, retries, concurrency, races, naming collisions, generated identifiers, filesystem behavior, and command-line tools.

## Review procedure

1. State the required outcome and the origin problem, and identify the changed execution paths.
2. Work through Direction until its completion criterion holds.
3. Try to falsify the change's material behavior, contract, safety, compatibility, rollout, and test claims.
4. Inspect callers, callees, tests, and established repository patterns that are necessary to evaluate those paths.
5. Apply the execution boundary when a candidate concern needs runtime evidence.
6. Research dependency behavior when a candidate concern depends on it.
7. Apply the finding gate to every candidate. Discard candidates that fail it.
8. Rank and report the admitted findings.

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

- `[blocking]`: The change cannot safely merge because it takes a direction that shouldn't merge, fails the required outcome, or creates a material correctness, security, data-loss, or operability defect.
- `[important]`: A proven, material problem should be corrected, but it does not make the change unsafe to merge. Drive-by hunks are at least `[important]`.
- `[suggestion]`: A supported structure improvement is useful but optional and in scope.

Severity follows demonstrated impact, not the reviewer's confidence or preference.

## Output

Lead with direction: the origin problem, then any direction findings. Then list defect findings, ordered by severity. For each finding include:

- severity and concise title;
- exact file and line;
- for a direction finding, the evidence and the shape that fits; for a defect, the reachable scenario, its concrete impact, and the evidence that proves the causal path;
- citations for each dependency claim; and
- the correction.

Then give a short verdict: `request changes`, `comment`, or `approve`. Approve only when direction holds and no defect finding blocks.

If no candidate passes the finding gate, say that no findings were found and approve. State a review-coverage limitation only when unavailable context prevented review of a required path. Describe the missing context without speculating about defects.
