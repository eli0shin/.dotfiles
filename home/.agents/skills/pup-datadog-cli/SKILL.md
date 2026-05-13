---
name: pup-datadog-cli
description: Use the pup CLI to interact with Datadog APIs for monitoring, observability, and incident investigation. Use when the user asks about Datadog metrics, traces, APM, RUM, SLOs, monitors, dashboards, notebooks, or needs to query/manage Datadog resources via the command line.
---
# Pup Datadog CLI

Pup is a Rust CLI wrapper for Datadog APIs providing OAuth2 and API key authentication across 9 key domains documented here: auth, metrics, monitors, dashboards, SLOs, RUM, APM, traces, and notebooks.

## Authentication

If you encounter auth errors run the token refresh command
```bash
pup auth refresh
```

If the refresh fails, prompt the user to run the login command

```bash
pup auth login
```


## Global Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--output` | `-o` | `json` | Output format: `json`, `table`, `yaml` |
| `--yes` | `-y` | `false` | Skip confirmation prompts (auto-approve destructive ops) |
| `--agent` | | `false` | Agent mode (auto-detected for AI coding assistants) |

Agent mode is auto-detected via environment variables (`OPENCODE=1`, `CLAUDECODE=1`, etc.) and changes behavior:
- `--help` returns structured JSON schema instead of text
- Confirmation prompts are auto-approved
- Errors return structured JSON with suggestions
- API responses are wrapped in metadata envelopes with count/truncation info

## Time Range Formats

All `--from` and `--to` flags accept these formats:

| Format | Examples |
|--------|----------|
| Relative short | `1h`, `30m`, `7d`, `5s`, `1w` |
| Relative long | `5min`, `5minutes`, `2hours`, `3days`, `1week` |
| With spaces | `"5 minutes"`, `"2 hours"` |
| With minus prefix | `-5m`, `-2h` (same as `5m`, `2h`) |
| RFC3339 | `2024-01-01T00:00:00Z` |
| Unix timestamp | `1704067200` |
| Keyword | `now` |

**Exception**: APM commands (`pup apm`) use Unix timestamps in seconds directly for `--start`/`--end`/`--from`/`--to` flags - they do NOT support relative time strings.

## Command Pattern

All commands follow:
```
pup <domain> <action> [flags]
pup <domain> <subgroup> <action> [flags]
```

## Domain Reference

| Domain | Reading Doc | Writing Doc | Status |
|--------|------------|-------------|--------|
| Metrics | `metrics-reading.md` | (none - read-only) | Read only |
| Monitors | `monitors-reading.md` | (none - read-only) | Read only |
| Dashboards | `dashboards-reading.md` | (none - read-only) | Read only |
| SLOs | `slos-reading.md` | (none - read-only) | Read only |
| RUM | `rum-reading.md` | (none - read-only) | Partial (some subcommands not impl) |
| APM | `apm-reading.md` | (none - read-only) | Read only |
| Traces | `traces-reading.md` | (none - read-only) | Read only |
| Notebooks | `notebooks-reading.md` | `notebooks-writing.md` | Fully working |

## Cross-Domain Investigation Workflows

### Error Investigation
```bash
# 2. Check monitors for alerting services
pup monitors list --tags="service:<name>"

# 3. Query error rate metrics
pup metrics query --query="sum:trace.servlet.request.errors{service:<name>}" --from="1h"

# 4. Check SLO compliance
pup slos list
```

### Performance Investigation
```bash
# 1. Check service latency via metrics
pup metrics query --query="avg:trace.servlet.request.duration{service:<name>} by {resource_name}" --from=1h

# 2. Get APM service stats for detailed breakdown
pup apm services stats --start=$(date -v-1H +%s) --end=$(date +%s) --env prod

# 3. List operations and find hot endpoints
pup apm services operations <service> --start=$(date -v-1H +%s) --end=$(date +%s)

# 4. View service dependencies
pup apm dependencies list <service> --env prod --start=$(date -v-1H +%s) --end=$(date +%s)

# 5. Check resource utilization
pup metrics query --query="avg:system.cpu.user{service:<name>} by {host}" --from=1h
```

### Service Health Overview
```bash
# 1. Check SLO status and error budgets
pup slos list

# 2. Check monitor states for a team
pup monitors list --tags="team:<team_name>"

# 3. Get service flow map
pup apm flow-map --query="env:prod" --from=$(date -v-1H +%s) --to=$(date +%s)
```

### Frontend User Experience Investigation
```bash
# 1. List RUM applications
pup rum apps list

# 2. Search for error sessions
pup rum sessions search --query="@type:error" --from="1h"

# 3. Find slow page loads
pup rum sessions search --query="@view.loading_time:>3000" --from="1h"

# 4. Check related dashboards
pup dashboards list
```

## Best Practices

1. **Always specify `--from`** - most commands default to 1h but be explicit
2. **Start narrow, widen later** - begin with `--from=1h`, expand to 24h/7d only if needed
3. **Filter at the API level** - use `--tags`, `--query`, `--name` instead of fetching everything and parsing locally
4. **Use aggregate where supported** - for domains like logs, prefer aggregate queries over fetching and counting raw events locally
5. **APM durations are in nanoseconds** - 1s = 1,000,000,000 ns, 1ms = 1,000,000 ns
6. **Use `--yes` for automation** - or rely on agent mode auto-approval for destructive operations
7. **Chain queries** - aggregate first to find patterns, then search for specifics
8. **Use jq for filtering** - pipe JSON output through jq for complex filtering: `pup slos list | jq '.data[] | select(.status.state == "breaching")'`

## Anti-Patterns

1. **Don't omit `--from`** on time-series queries - you'll get unexpected ranges or errors
2. **Don't use `--limit=1000` as a first step** - start small and refine
3. **Don't list all monitors without filters** in large orgs (>10k monitors)
4. **Don't assume durations are in seconds** - APM trace durations use nanoseconds
5. **Don't retry 401/403 errors** - re-authenticate or check permissions instead
6. **Don't use `--from=30d`** unless you specifically need a month of data

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Authentication failed | `pup auth login` or check DD_API_KEY/DD_APP_KEY |
| 403 | Insufficient permissions | Verify API/App key scopes |
| 404 | Resource not found | Check the resource ID |
| 429 | Rate limited | Wait and retry with backoff |
| 5xx | Server error | Retry after delay; check https://status.datadoghq.com/ |
