# Search Slack

Search messages as JSON, then keep only useful fields:

```bash
slackcli search messages '<query>' --limit=100 --json \
  | jq -r '.matches[] | [.channel.id, .channel.name, .ts, (.text | gsub("[\\r\\n\\t]+"; " ")), .permalink] | @tsv'
```

Search results are in `.matches[]`, not `.messages[]`. Inspect `.page` and `.pages`; rerun with `--page=<n>` until all relevant pages are covered.

A result is in a thread when its permalink contains `thread_ts`; group matching replies by that value and link to the thread root. Ignore empty-text alert/bot matches unless their attachments are relevant.

To search for a person, use `slackcli search people '<name>' --json`, then search messages with `from:<username>`; an IM result's `.channel.id` can be passed to `scripts/read-conversation`.

Use `--in <channel>` when the user requests a channel or when the results reveal a relevant channel; prefer exact phrases when a broad query is noisy.
