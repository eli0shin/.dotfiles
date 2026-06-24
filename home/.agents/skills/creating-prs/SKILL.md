---
name: creating-prs
description: Create pull requests. Use when opening a GitHub PR, drafting a PR title/body, preparing a pull request description, or reviewing a branch before PR creation.
---

# Creating PRs

A good PR feels native to its repo and gives a familiar reviewer the missing context they need to trust the change.

## Steps

1. **Read the repo convention.** Inspect the PR template and a few recent PR titles and descriptions. Done when you know the expected title shape, whether Jira tickets are required, whether ticket links appear in the body, and which template sections are actually used.

2. **Find the ticket.** If repo convention expects Jira tickets, derive the ticket key from the branch or commits using the `ABC-123` shape. If the repo expects one and you cannot find it, ask the user for it before drafting the PR. Done when the title can start with the ticket key or you know this repo does not require one.

3. **Understand the change.** Review the branch diff and commits as the source of truth. Done when you can describe the user-visible behavior, workflow, constraint, or system capability that changed, plus the motivation/context a codebase-familiar reviewer would not infer from the diff alone.

4. **Draft a native title.** Mirror recent PRs. When Jira tickets are expected, use `TICKET-123: Imperative summary`. Done when the title is short, imperative, repo-native, and includes the ticket key when required.

5. **Draft the body from the template.** Follow the repo PR template, pruning irrelevant sections instead of padding them. Done when every retained section has useful content and no removed section would help the reviewer.

6. **State verification as change-specific evidence.** Verification is the evidence that this PR's behavior is covered, not a log of commands run. Prefer evidence that exercises the system boundary a reviewer cares about: Playwright, API, integration, contract, or other end-to-end-ish coverage. Unit tests are the lowest form of PR verification; cite them only when this change genuinely cannot be covered at a higher boundary, and say what behavior they prove. If no meaningful coverage was added, explain the honest confidence boundary: why coverage was not possible or not relevant, and what remains unproven. Only include manual validation steps when a reviewer truly needs them. Done when the section answers “what evidence proves this change works?” without mentioning routine local commands.

## PR description rules

- Fill in missing context: why the change exists, what prompted it, and any constraint the reviewer needs to know.
- Describe behavior and system effects, not individual lines, functions, or implementation trivia.
- Do not mention routine local commands such as typecheck, lint, `npm test`, or unit-test command names in the PR body. They are not verification evidence for reviewers.
- Do not cite unit test coverage when higher-boundary coverage was added or could reasonably have been added.
- If recent PRs link Jira tickets and you have a ticket key, create the matching link in the repo's established format.
- Be honest about partial verification, infra-only changes, feature-flagged work, or changes that require a later PR before they can be observed.
