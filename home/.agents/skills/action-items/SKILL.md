---
name: action-items
description: Eli's personal action items in the workbench. Use when Eli asks what he owes or has committed to, wants a follow-up tracked, reports an item done or in progress ("I already talked to Harry"), or wants to brainstorm one.
---

# Action items

An action item is a follow-up Eli personally owes: something he said he would do, or that Ben assigned to him. It may concern a project, PR, or Jira issue, but it is not a project deliverable; it links to those instead of duplicating them. An open PR is its own artifact, so never create an action item to get a PR reviewed, approved, or merged. Other people's commitments are not action items.

## The workbench

Action items live in the embedded Tickets project at `~/code/workbench/.tickets`. Run every `tickets` command from there, whatever the current directory:

```bash
(cd ~/code/workbench && tickets list)
```

Follow the `tickets` skill for the CLI rules. Every item is Eli's, so create it with `--assign Eli`; claiming is already settled.

## Statuses

- `todo` — Eli owes it and hasn't started.
- `in-progress` — Eli is actively working it (a draft, a thread he's driving).
- `waiting` — blocked on someone else. List every external blocker in `Waiting-On` frontmatter (see below), and explain in the body what each one owes.
- done — via `tickets done`, after appending the resolution.

## Ticket body

The description is a short imperative (`draw crawl walk run diagram for jimmy`). The body holds:

```markdown
**Commitment:** what Eli owes, in his words where a quote exists.
**Why/For:** who is waiting on it or what it unblocks.
**Source:** meeting title + date + timestamp, Slack permalink, or PR link — one line per source.
**Links:** related PRs, Jira issues, project tickets, notes/ files.
**Context:** other people's related follow-ups that shape this item.

## Log
- 2026-09-28: dated progress notes, newest last.
```

`Blocked-By` accepts only ticket IDs from this tracker. Put blockers from outside it in a `Waiting-On` list, placed after `Blocked-By`: Jira keys, PR or Slack URLs, or people's names from `people.md`. Every `waiting` item needs at least one entry, and an item with none isn't `waiting`. Lint doesn't validate `Waiting-On`, so check it by hand.

```yaml
Blocked-By: []
Waiting-On:
  - FANDEVX-3935
  - Ian Bartholomew
```

Tag by project or theme (`ffs-admin`, `fanapp-ios`, `snowflake`) so items group in reports.

## Operations

- **Create** — search open and done items first (`tickets search`, grep `.tickets/` for the source ID or topic) and add a new source to the matching item rather than creating a duplicate.
- **Update** — when Eli reports progress, append a dated `Log` line and move the status if it changed.
- **Complete** — append the resolution to `Log` (`- 2026-09-28: Done — talked to Harry, he's reviewing #2011`), then `tickets done`.
- **Brainstorm** — read the item and its links, gather code and meeting context, and keep the working thinking in `~/code/workbench/notes/<ticket-id>-<slug>.md` linked from the body.
