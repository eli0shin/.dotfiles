---
name: pup-datadog-cli
description: "Use pup for stable, scriptable Datadog API-shaped work: metrics, logs, monitors, dashboards, SLOs, RUM, APM, traces, notebooks, and repeatable shell/runbook commands. Prefer datadog-mcp for discovery, enrichment, DDSQL, Kubernetes resources, monitor validation/recommendations, widgets, incidents, and error tracking."
---
# Pup Datadog CLI

Pup is the default Datadog CLI when the task is **stable, repeatable, API-shaped, or scriptable**.

Use it when you already know the Datadog domain/query/resource and need a predictable command that can be copied into a runbook, script, or terminal session.

## Router: pup vs Datadog MCP

Prefer **pup** for:
- direct metrics/logs/traces/RUM/APM/SLO/monitor/dashboard/notebook API queries
- repeatable shell commands and scripts
- `jq` pipelines and structured JSON processing
- known metric names, tags, trace attributes, monitor IDs, dashboard IDs, etc.
- notebook writing/CRUD workflows

Prefer **datadog-mcp** for:
- discovering metric tags, metric context, or related dashboards/monitors/SLOs
- discovering span/log/RUM attributes before aggregating on them
- DDSQL schema discovery, saved queries, and ad-hoc SQL analysis
- Kubernetes resource search/describe/manifest without local kubeconfig
- monitor templates, threshold recommendation, message generation, and validation
- dashboard widget rendering/visualization helpers
- incidents, service dependencies, error tracking, and Datadog MCP skills

If unsure: use `datadog-observability` first for routing.

## Auth recovery

If you encounter auth errors:

```bash
pup auth refresh
```

If refresh fails, ask the user to run:

```bash
pup auth login
```

## Command pattern

```bash
pup <domain> <action> [flags]
pup <domain> <subgroup> <action> [flags]
```

Discover commands with structured help:

```bash
pup --help
pup metrics --help
pup traces search --help
```

## Critical gotchas

- Always specify `--from` on time-based queries.
- Start narrow (`--from=1h`) and widen only if needed.
- Filter at the API level (`--query`, `--tags`, `--name`, `--limit`) before using `jq`.
- Use aggregate commands for counts/distributions; do not fetch raw events just to count them.
- APM/span durations are in nanoseconds unless a command explicitly says otherwise.
- For commands written into scripts/runbooks/CI, add `--no-agent` so output matches a normal user shell.
- `pup apm` time flags may require Unix timestamps; check the domain doc/help before using relative times.

## Common examples

```bash
# Metric query when metric + tags are known
pup metrics query --query='avg:system.cpu.user{env:prod} by {host}' --from=1h

# Trace aggregation when attribute is known
pup traces aggregate --query='service:api' --compute='count' --group-by='@http.status_code' --from=1h

# Script/runbook-safe monitor listing
pup --no-agent monitors list --tags='team:payments' --output=json
```

## Read the right detail doc

Load the smallest relevant file before doing domain-specific work:

- Metrics: `metrics-reading.md`
- Monitors: `monitors-reading.md`
- Dashboards: `dashboards-reading.md`
- SLOs: `slos-reading.md`
- RUM: `rum-reading.md`
- APM service topology/entities: `apm-reading.md`
- Traces/spans: `traces-reading.md`
- Notebooks read/write: `notebooks-reading.md`, `notebooks-writing.md`

## Error handling

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Authentication failed | `pup auth refresh`, then `pup auth login` if needed |
| 403 | Insufficient permissions | Verify scopes/API/App keys |
| 404 | Resource not found | Check ID, site, org, time window |
| 429 | Rate limited | Narrow query or retry with backoff |
| 5xx | Server error | Retry later; check Datadog status |
