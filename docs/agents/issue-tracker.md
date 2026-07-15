# Issue tracker: Local Markdown

Issues and specs (including PRDs) for this repository live as Markdown files under `.scratch/`.

Adapted from Matt Pocock's [local Markdown issue-tracker convention](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md).

## Conventions

- One effort per directory: `.scratch/<effort-slug>/`.
- The spec is `.scratch/<effort-slug>/spec.md`.
- Implementation issues are separate files under `.scratch/<effort-slug>/issues/`, numbered from `01`; never combine multiple tickets into one file.
- Ticket filenames use `<NN>-<slug>.md`.
- `Status:` near the top of a ticket records its state.
- Comments and conversation history are appended under `## Comments`.
- References between local issues use relative Markdown links with the ticket name as link text, not bare numbers.

## Publishing and fetching

When a skill says **publish to the issue tracker**, create the appropriate Markdown file under `.scratch/<effort-slug>/`, creating its directories as needed.

When a skill says **fetch the relevant ticket**, read the referenced Markdown file. A user may identify it by path, ticket number within the effort, or ticket name.

When a skill says **comment**, append the comment under `## Comments`, creating that heading if necessary.

When a skill says **close** or **resolve**, update `Status:` to `resolved` and record the resolution in the ticket.

## Ticket shape

```markdown
# <Ticket name>

Status: open

## What to build

<ticket body>

## Comments
```

Use the body structure required by the invoking skill when it provides one.

## Wayfinding operations

Used by `/wayfinder`. A Wayfinder **map** is one file with one child file per decision ticket.

- **Map:** `.scratch/<effort-slug>/map.md`, containing Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket:** `.scratch/<effort-slug>/issues/<NN>-<slug>.md`, numbered from `01`, with the decision question in its body.
- **Type:** a `Type:` line records `research`, `prototype`, `grilling`, or `task`.
- **Status:** a `Status:` line records `open`, `claimed`, or `resolved`.
- **Blocking:** a `Blocked by: NN, NN` line records dependencies. A ticket is unblocked when every listed ticket is `resolved`. Use `Blocked by: none` when it has no blockers.
- **Frontier:** scan the effort's `issues/` directory in numeric order and select tickets that are `open`, unblocked, and unclaimed.
- **Claim:** change `Status: open` to `Status: claimed` and save before doing any work.
- **Resolve:** append the result under `## Answer`, change `Status:` to `resolved`, then append a one-line gist and relative link to the map's `## Decisions so far` section.
- **Comments:** append discussion under `## Comments`; the answer remains the authoritative resolution.

### Wayfinder ticket shape

```markdown
# <Decision ticket name>

Type: research
Status: open
Blocked by: none

## Question

<the decision or investigation this ticket resolves>

## Answer

<!-- Added when resolved. -->

## Comments
```
