---
name: datadog-mcp
description: "Use Datadog's MCP server through mcp2cli for agent-native Datadog investigation workflows: DDSQL, Kubernetes resource inspection, metric context/tag discovery, span/log/RUM attribute discovery and aggregation, monitor authoring/validation, dashboard widgets, notebooks, incidents, services, dependencies, and error tracking. Prefer pup-datadog-cli for stable scriptable Datadog API queries."
---
# Datadog MCP

Datadog MCP is the discovery/enrichment/validation layer for Datadog. It complements `pup-datadog-cli`; it does not replace it.

Use the bundled wrapper instead of repeating the long MCP URL:

```bash
scripts/datadog-mcp --list
scripts/datadog-mcp --search metric
scripts/datadog-mcp <tool> --help
```

Most Datadog MCP tools require telemetry; pass an empty object unless you have a reason to include more:

```bash
--telemetry '{}'
```

## Router: MCP vs pup

Prefer **Datadog MCP** for:
- discovery: metric tags/context, span/log/RUM attributes, DDSQL schemas
- enriched investigation: Kubernetes resources, incidents, service dependencies, error tracking
- authoring helpers: monitor templates, threshold recommendations, message generation, validation
- dashboard/widget/notebook helpers: widget rendering, visualization, notebook cell validation
- Datadog-specific MCP skills and guided tool behavior

Prefer **pup-datadog-cli** for:
- stable API-shaped queries once fields/tags are known
- scripts, runbooks, CI, and copy-paste shell commands
- straightforward metrics/logs/traces/RUM/APM/SLO/monitor/dashboard/notebook reads
- notebook CRUD/writing flows

Workflow rule: **MCP to discover; pup to operationalize**.

## Core command pattern

```bash
# list/search tools
scripts/datadog-mcp --list
scripts/datadog-mcp --search ddsql

# inspect one tool
scripts/datadog-mcp get-datadog-metric-context --help

# execute
scripts/datadog-mcp get-datadog-metric-context \
  --metric-name system.cpu.user \
  --telemetry '{}'
```

## Discovery workflows

### Metric tags and context

Use this before writing metric queries if you do not know available dimensions.

```bash
scripts/datadog-mcp get-datadog-metric-context \
  --metric-name trace.http.request.duration \
  --include-tag-values \
  --scope-tags '["env:prod"]' \
  --window 14400 \
  --telemetry '{}'
```

Useful variants:

```bash
# cheaper: tag keys only
scripts/datadog-mcp get-datadog-metric-context \
  --metric-name system.cpu.user \
  --telemetry '{}'

# find related dashboards/monitors/notebooks/SLOs
scripts/datadog-mcp get-datadog-metric-context \
  --metric-name system.cpu.user \
  --include-related-assets \
  --telemetry '{}'
```

After discovery, use pup for repeatable queries:

```bash
pup metrics query --query='avg:trace.http.request.duration{env:prod} by {service}' --from=1h
```

### Span attributes

Use `search-datadog-spans` with `custom-attributes` to sample available attributes.

```bash
scripts/datadog-mcp search-datadog-spans \
  --query 'service:checkout' \
  --from now-1h \
  --custom-attributes '["*"]' \
  --max-tokens 20000 \
  --telemetry '{}'
```

Then validate candidate dimensions with aggregation:

```bash
scripts/datadog-mcp aggregate-spans \
  --query 'service:checkout' \
  --from now-1h \
  --group-by '{"fields":["@http.status_code"]}' \
  --computes '[{"aggregation":"count","type":"total","name":"count"}]' \
  --telemetry '{}'
```

Use pup once the attribute is known:

```bash
pup traces aggregate --query='service:checkout' --compute='count' --group-by='@http.status_code' --from=1h
```

### Logs and RUM attributes

For raw event inspection/discovery, use search tools with narrow windows and token caps. For counts or grouped analysis, use aggregate/analyze tools instead of fetching raw events.

```bash
scripts/datadog-mcp search-datadog-logs \
  --query 'service:checkout status:error' \
  --from now-1h \
  --extra-fields '["*"]' \
  --max-tokens 12000 \
  --telemetry '{}'

scripts/datadog-mcp search-datadog-rum-events \
  --query '@type:error env:prod' \
  --from now-1h \
  --detailed-output \
  --max-tokens 12000 \
  --telemetry '{}'
```

### DDSQL

DDSQL is MCP-first. Use the discovery sequence before writing non-trivial SQL:

```bash
scripts/datadog-mcp ddsql-get-spec --telemetry '{}'
scripts/datadog-mcp ddsql-schema-search-tables --query logs --telemetry '{}'
scripts/datadog-mcp ddsql-schema-get-table-columns --table-name '<table>' --telemetry '{}'
scripts/datadog-mcp ddsql-run-query --sql-query 'SELECT ...' --telemetry '{}'
```

Gotchas from the MCP tool descriptions:
- DDSQL is a PostgreSQL subset, not full Postgres.
- Every non-aggregated `SELECT` column must appear in `GROUP BY`.
- Do not reuse `SELECT` aliases in `WHERE`/`GROUP BY`/`HAVING`; repeat the expression.
- Avoid unsupported constructs like `ANY()`, `->>`, `QUALIFY`, `information_schema`, and `current_timestamp`.

## Investigation workflows

### Kubernetes resource state

Use MCP instead of `kubectl` when you need Datadog's cross-cluster/enriched resource view or do not have local kubeconfig.

```bash
scripts/datadog-mcp search-datadog-k8s-resources \
  --kind pod \
  --query 'pod_status:crashloopbackoff team:$team' \
  --include-tags 'team,service,env,kube_cluster_name,kube_namespace' \
  --telemetry '{}'
```

Then drill in:

```bash
scripts/datadog-mcp describe-datadog-k8s-resource --help
scripts/datadog-mcp get-datadog-k8s-manifest --help
```

### Monitor authoring/validation

Use MCP before creating or changing monitors:

```bash
scripts/datadog-mcp get-monitor-templates --telemetry '{}'
scripts/datadog-mcp recommend-monitor-threshold --help
scripts/datadog-mcp generate-monitor-message --help
scripts/datadog-mcp validate-monitor-definition \
  --monitor-definition '<json>' \
  --telemetry '{}'
```

### Dashboards, widgets, notebooks

Use MCP for widget rendering/conversion/visualization and notebook cell validation. Use pup for durable notebook CRUD flows.

```bash
scripts/datadog-mcp get-widget --help
scripts/datadog-mcp visualize-tabular-data --help
scripts/datadog-mcp validate-notebook-cells --help
```

### Incidents, services, dependencies, error tracking

```bash
scripts/datadog-mcp search-datadog-incidents --query 'state:(active OR stable)' --telemetry '{}'
scripts/datadog-mcp search-datadog-services --query 'team:payments' --telemetry '{}'
scripts/datadog-mcp search-datadog-service-dependencies --service checkout --telemetry '{}'
scripts/datadog-mcp search-datadog-error-tracking-issues --help
```

## Output and safety gotchas

- Use narrow time ranges first: `now-1h`, then widen.
- MCP relative time usually needs the `now-` prefix; pup accepts `1h`.
- Use `--max-tokens` aggressively on raw events and wildcard attributes.
- Avoid `custom-attributes '["*"]'` or `extra-fields '["*"]'` on broad queries/time ranges.
- Prefer aggregate/analyze tools for counts and distributions.
- Treat MCP output as discovery/enrichment; convert stable final commands to `pup` when writing scripts.
