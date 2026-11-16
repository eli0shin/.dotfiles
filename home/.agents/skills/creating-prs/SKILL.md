---
name: creating-prs
description: Create pull requests. Use when opening a GitHub PR, drafting a PR title/body, preparing a pull request description, or reviewing a branch before PR creation.
---

# Creating PRs

A good PR feels native to its repo and gives a familiar reviewer the missing context they need to trust the change.

## Steps

1. **Read the repo convention.** Inspect the PR template and a few recent PR titles and descriptions. Done when you know the expected title shape, whether Jira tickets are required, whether ticket links appear in the body, and which template sections are actually used.

2. **Find the ticket.** If repo convention expects Jira tickets, derive the ticket key from the branch or commits using the `ABC-123` shape. If the repo expects one and you cannot find it, search the tracker for a ticket covering this work, and create one from the user's requirements when none matches. Done when the title can start with the ticket key or you know this repo does not require one.

3. **Understand the change.** Review the branch diff and commits as the source of truth. Done when you can describe the user-visible behavior, workflow, constraint, or system capability that changed, plus the motivation/context a codebase-familiar reviewer would not infer from the diff alone.

4. **Draft a native title.** Mirror recent PRs. When Jira tickets are expected, use `TICKET-123: Imperative summary`. Done when the title is short, imperative, repo-native, and includes the ticket key when required.

5. **Draft the body from the template.** Follow the repo PR template, pruning irrelevant sections instead of padding them. Done when every retained section has useful content and no removed section would help the reviewer.

6. **State verification as change-specific evidence.** Verification is the coverage that proves this PR's behavior, not a log of where or when anything ran. Prefer evidence that exercises the system boundary a reviewer cares about: Playwright, API, integration, contract, or other end-to-end-ish coverage. A spec that runs against this PR's preview or in CI is evidence like any other: name the behavior it covers. Unit tests are the lowest form of PR verification; cite them only when this change genuinely cannot be covered at a higher boundary, and say what behavior they prove. When a change has no behavior a test can reach (docs, config, infra plumbing), say what the reviewer should check instead. Only include manual validation steps when a reviewer truly needs them. Done when the section answers “what evidence proves this change works?” and every sentence names coverage that exists.

## PR description rules

- Fill in missing context: why the change exists, what prompted it, and any constraint the reviewer needs to know.
- Describe behavior and system effects, not individual lines, functions, or implementation trivia.
- Do not mention routine local commands such as typecheck, lint, `npm test`, or unit-test command names in the PR body. They are not verification evidence for reviewers.
- Do not cite unit test coverage when higher-boundary coverage was added or could reasonably have been added.
- If recent PRs link Jira tickets and you have a ticket key, create the matching link in the repo's established format.
- Name what gates the behavior: a feature flag, an infra-only change, or a later PR it waits on before it can be observed.
- The testing section never narrates the agent's own run: no "couldn't run locally", "hasn't run yet", "CI is the first run", or "only ran against the preview". Reviewers read it as an untested PR, and later PRs copy it. State the coverage, and leave out where it ran.
