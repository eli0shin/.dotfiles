---
name: agent-status
description: Triage every agent running in herdr — sessions that need Eli, orchestrators waiting on a stopped worker, PRs to push, sessions to close. Use when Eli asks for the state of his agents, what needs his attention, or which sessions are stalled or can be closed.
---

The answer is a **triage**: what Eli must do, what to push, and what to close. The agent table is its appendix.

## 1. Gather

Run [`scripts/agent-status --signals`](scripts/agent-status) for per-agent JSON and `scripts/agent-status` for the table. Fields that need reading:

- `herdr_status: done` means the agent finished a turn Eli hasn't viewed yet.
- `last_turn_reaches_orchestrator: false` means the orchestrator never learns that this worker stopped. PR Watch forwards a worker's finished turn only when the worker watches no PR, and failed CI and conflicts go only to the worker.
- `linked_prs` and `linked_runs` are GitHub PRs and runs that the last assistant message links. A run's `waiting_jobs` are waiting for approval.
- `human_reviews` excludes bots and the PR author.

## 2. Classify

Put every session except the current one in exactly one bucket, judging its last assistant message by its content. The first match wins:

1. **Needs you:** `herdr_status` is `blocked` or `done`, the last message asks Eli a question or waits for his decision, or a linked run has `waiting_jobs`.
2. **Check on worker:** the worker has stopped and nothing is in flight, so the orchestrator keeps waiting on an event that will never come. All of these hold:
   - the orchestrator is idle;
   - the worker has been idle 30+ minutes, with `last_turn_reaches_orchestrator: false`;
   - its open PR has no pending checks.

   A short wait after a worker stops is normal; this bucket is for the wait that doesn't end. The worker's last message shows why it stopped: it reported that CI still fails, gave a lengthy answer to a question, or did anything other than hand off to reviewers. File this under the orchestrator, name the worker, and summarize what it last said.
3. **Close after reply:** the last message offers a tidy-up (remove worktrees, delete backups). Recommend accepting the offer, then closing.
4. **Close:** idle, watching no open PR (none, or every PR merged or closed), and its last message holds no real question. Confirm each loose end it mentions has been handled: tracked as an action item in `~/code/workbench/.tickets`, or landed (merged, or on `main`). If one isn't, the session goes in **Needs you**.
5. **Parked:** idle on an open PR that moves without Eli, or on a named dependency. Its last message reports status only.

Separately, list every open watched or linked PR that is **stuck on a human** as **Drive**: no human review, conflicts on someone else's PR, or a failing check nobody is working on. Name the person or team to nudge. A session waiting on that PR stays **Parked**.

## 3. Report

Use the sections Needs you, Check on worker, Drive, Close after reply, Close, and Parked, then the table. Give each session one line: workspace and tab, what's going on, and the action Eli takes. Pane IDs, session IDs, and pr-watch errors stay out. Then stop for Eli's call.

## 4. Act

When Eli names sessions to close, focus, reply to, resume, or nudge, follow [`ACTIONS.md`](ACTIONS.md).
