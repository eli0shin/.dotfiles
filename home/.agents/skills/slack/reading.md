# Reading conversations

Use [`scripts/read-conversation`](scripts/read-conversation) for compact output.

The script requests up to 1,000 messages. If it returns exactly 1,000, fetch older batches with `slackcli conversations read --limit=1000 --latest=<earliest-ts> --json`; for a thread, include `--thread-ts=<root-ts>`. Continue with the earliest timestamp from each batch until fewer than 1,000 messages are returned.
