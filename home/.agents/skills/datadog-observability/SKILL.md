---
name: datadog-observability
description: Route Datadog observability tasks between pup-datadog-cli and datadog-mcp. Use this first when the user asks about Datadog and it is not obvious whether the stable pup CLI or the Datadog MCP discovery/enrichment layer is the right tool.
---
# Datadog Observability Router

Use this skill first for Datadog work when tool choice is unclear. It routes between:

- `pup-datadog-cli`: stable, scriptable Datadog API CLI
- `datadog-mcp`: Datadog MCP discovery/enrichment/validation layer

## Default rule

- **Known query/resource + repeatable command** → use `pup-datadog-cli`.
- **Discovery/enrichment/validation/investigation helper** → use `datadog-mcp`.
- **Exploration first, then runbook** → use `datadog-mcp` to discover, then translate final query to `pup`.

## Route to pup-datadog-cli

Use pup when the user asks for:

- metrics query with known metric/tags
- logs/traces/RUM search or aggregation with known fields
- monitors/dashboards/SLOs/notebooks listed or fetched by known filters/IDs
- APM service stats, operations, dependencies, or flow maps using known env/service
- commands that should be pasted into a terminal, script, CI job, or runbook
- stable JSON/table/yaml/csv output and `jq` processing
- notebook CRUD/writing flows

Load `pup-datadog-cli/SKILL.md`, then the relevant detail doc.

Examples:

```bash
pup metrics query --query='avg:system.cpu.user{env:prod} by {host}' --from=1h
pup traces aggregate --query='service:api' --compute='count' --group-by='@http.status_code' --from=1h
pup --no-agent monitors list --tags='team:payments' --output=json
```

Important: use `pup --no-agent` for scripts/runbooks/CI so output shape matches a normal user shell.

## Route to datadog-mcp

Use Datadog MCP when the user asks for:

- “what tags does this metric have?”
- “what span/log/RUM attributes exist?”
- “find related dashboards/monitors/SLOs/notebooks for this metric”
- DDSQL schema discovery, SQL querying, saved DDSQL queries, DDSQL UI links
- Kubernetes resource state, manifests, or describes without local kubeconfig
- error tracking issues
- incidents, service catalog-ish search, service dependencies
- monitor templates, coverage, threshold recommendation, message generation, validation
- dashboard widget rendering or ad-hoc visualization
- notebook cell validation
- Datadog MCP skills/guidance

Load `datadog-mcp/SKILL.md`.

Examples:

```bash
${CLAUDE_SKILL_DIR}/../datadog-mcp/scripts/datadog-mcp get-datadog-metric-context \
  --metric-name trace.http.request.duration \
  --include-tag-values \
  --scope-tags '["env:prod"]' \
  --telemetry '{}'

${CLAUDE_SKILL_DIR}/../datadog-mcp/scripts/datadog-mcp search-datadog-spans \
  --query 'service:api' \
  --custom-attributes '["*"]' \
  --from now-1h \
  --max-tokens 20000 \
  --telemetry '{}'
```

## Common routing decisions

| User asks | Use | Why |
|---|---|---|
| Query `avg:system.cpu.user{env:prod}` | pup | Known metric query |
| Find available tags for `system.cpu.user` | datadog-mcp | Metric context/tag discovery |
| Count traces by `@http.status_code` | pup | Known span facet aggregation |
| Discover span attributes for a service | datadog-mcp | Attribute discovery via sampled spans |
| Search logs for errors | pup if query known; MCP if discovering fields | Depends on certainty |
| Count/group logs | pup or MCP aggregate/analyze; never raw fetch + local count | Aggregation first |
| Inspect crashing pods across clusters | datadog-mcp | K8s resource search/describe via Datadog |
| Create a runbook command | pup | Stable CLI and `--no-agent` |
| Validate a monitor JSON | datadog-mcp | Dedicated validation tool |
| Write/update notebook | pup | Existing pup notebook writing support |
| Validate notebook cells | datadog-mcp | Dedicated cell validation |
| Find dashboards using a metric | datadog-mcp | Related assets from metric context |
| Fetch dashboard by ID | pup if simple; MCP if widget/rendering needed | Depends on follow-up |

## Mixed workflow templates

### Discover metric tags, then write a reusable query

1. Use MCP:

```bash
${CLAUDE_SKILL_DIR}/../datadog-mcp/scripts/datadog-mcp get-datadog-metric-context \
  --metric-name '<metric>' \
  --include-tag-values \
  --scope-tags '["env:prod"]' \
  --telemetry '{}'
```

2. Use pup for the final repeatable command:

```bash
pup metrics query --query='avg:<metric>{env:prod} by {service}' --from=1h
```

### Discover span attributes, then aggregate reliably

1. Use MCP:

```bash
${CLAUDE_SKILL_DIR}/../datadog-mcp/scripts/datadog-mcp search-datadog-spans \
  --query 'service:<service>' \
  --custom-attributes '["*"]' \
  --from now-1h \
  --max-tokens 20000 \
  --telemetry '{}'
```

2. Use pup:

```bash
pup traces aggregate --query='service:<service>' --compute='count' --group-by='@candidate.attribute' --from=1h
```

## Anti-patterns

- Do not use MCP as a runbook output format if pup can express the final known query.
- Do not use pup to brute-force discover unknown attributes by fetching huge raw datasets.
- Do not omit time ranges.
- Do not write scripts with agent-mode pup output; include `--no-agent`.
- Do not use broad wildcard MCP discovery (`["*"]`) over wide time ranges.
