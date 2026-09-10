---
name: search-meetings
description: Search local meeting transcripts, summaries, action items, decisions, attendees, and calendar metadata. Use whenever the user refers to a meeting or asks about past discussions, decisions, commitments, follow-ups, or action items.
---

# Search meetings

Search `~/Library/Application Support/MacParakeet/meeting-recordings/` with `fd`, `rg`, and file reads as the question requires. For date queries such as today, this week, or last week, filter meetings by the `createdAt` frontmatter in `meeting.md` using local calendar boundaries.

Each meeting directory can contain:

- `prompt-results/*Summary.md` — summary, decisions, and open questions
- `prompt-results/*Action Items & Decisions.md` — commitments and follow-ups
- `meeting.md` — dated transcript with speaker labels
- `meeting-recording-metadata.json` — calendar title, organizer, attendees, and capture details

Start with summaries and action items, then inspect transcripts when more context or verification is useful. Use calendar metadata for attendee claims, and distinguish calendar attendees from identified speakers. A recent recording can have metadata and audio before its transcript and prompt results exist.
