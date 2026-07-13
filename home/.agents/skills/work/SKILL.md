---
name: work
description: Go from a Jira ticket (usually the current branch name) to a shared understanding of what to build, before any implementation.
disable-model-invocation: true
---

The branch is named after a Jira ticket. Reach **shared understanding** with the user about what this ticket really asks for — *before* discussing how to build it.

Use the `jira-acli` and `confluence-acli` skills for any Jira/Confluence reads. Use the project's domain glossary and respect any ADRs in the area you're touching.

## Process

1. Derive the ticket key from the branch name and read the story. If it belongs to an epic, read the epic for the larger goal — a small one-off may have none. Follow any doc links (Confluence, design docs, external references); for research/design tickets the real spec usually lives outside Jira.

2. If the ticket is a jira ticket and it is not in the active sprint move it into the active sprint. If it is not yet assigned to me assign it to me.

3. Explore the repo for the docs, existing implementation, and the pieces this ticket will touch or build on. Pull only what bears on this ticket; skip the rest. You're done when you can state what exists today and where this ticket fits, without guessing.

4. State your understanding back to the user — **short and punchy, never walls of text**:

 - **Project** — a sentence or two.
 - **Problem** — a sentence or two.
 - **Building** — the core thing this ticket delivers, a few tight lines.

 Check this with the user. Once they've confirmed or corrected it, run a `/grilling` session to sharpen the approach, then hand off to `/to-prd` or `/implement` when the approach is agreed.
