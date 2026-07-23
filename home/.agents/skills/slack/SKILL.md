---
name: slack
description: Reads Slack channels, threads, and DMs. Use when the user asks to read, inspect, or summarize a Slack conversation.
---

# Slack

To read a channel or DM, or a specific thread, run [`scripts/read-conversation`](scripts/read-conversation). For reads exceeding 1,000 messages, follow [reading.md](reading.md):

```bash
./scripts/read-conversation <channel-id> [thread-ts]
```

For message, thread, channel, or DM discovery, follow [search.md](search.md).
