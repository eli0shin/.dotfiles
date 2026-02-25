# Traces: Reading (Querying APM Traces)

## Commands

### Search Spans

```bash
pup traces search --query="<query>" [--from="<time>"] [--to="<time>"] [--limit=N] [--sort="<order>"]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--query` | No | `*` | Span search query |
| `--from` | No | `1h` | Start time |
| `--to` | No | `now` | End time |
| `--limit` | No | `50` | Max spans to return (1-1000) |
| `--sort` | No | `-timestamp` | Sort order: `timestamp` (ascending) or `-timestamp` (descending) |

Returns span data including service, resource, duration, tags, and trace IDs.

```bash
# Search all spans in the last hour (defaults)
pup traces search

# Error spans for a specific service
pup traces search --query="service:api status:error" --from="1h"

# Slow spans (duration shorthand)
pup traces search --query="service:web-server @duration:>5s" --from="4h"

# Look up a specific trace by ID
pup traces search --query="trace_id:abc123def456"

# Only server-side errors (inbound requests that failed)
pup traces search --query="service:api status:error @span.kind:server" --from="1h"

# Only client-side errors (outbound calls that failed)
pup traces search --query="service:api status:error @span.kind:client" --from="1h"

# Server errors with limit and sort
pup traces search --query="@http.status_code:>=500" --limit=100 --sort="timestamp"

# Filter by environment and resource
pup traces search --query="env:production resource_name:\"GET /api/users\"" --from="2h"
```

### Aggregate Spans

```bash
pup traces aggregate --query="<query>" --compute="<func>" [--from="<time>"] [--to="<time>"] [--group-by="<facet>"]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--query` | No | `*` | Span search query |
| `--from` | No | `1h` | Start time |
| `--to` | No | `now` | End time |
| `--compute` | Yes | (none) | Aggregation function (see table below) |
| `--group-by` | No | (none) | Facet to group results by |

Returns computed statistics (not individual spans), optionally grouped by a facet.

**Compute functions:**

| Compute | Description |
|---------|-------------|
| `count` | Count of matching spans |
| `avg(@field)` | Average value |
| `sum(@field)` | Sum |
| `min(@field)` | Minimum |
| `max(@field)` | Maximum |
| `median(@field)` | Median |
| `cardinality(@field)` | Unique count |
| `percentile(@field, N)` | Percentile (supported: 75, 90, 95, 98, 99) |

```bash
# Count all error spans
pup traces aggregate --query="status:error" --compute="count"

# Average duration by service
pup traces aggregate --query="env:production" --compute="avg(@duration)" --group-by="service"

# P99 latency by resource
pup traces aggregate --query="service:api" --compute="percentile(@duration, 99)" --group-by="resource_name"

# Count unique users hitting errors
pup traces aggregate --query="status:error" --compute="cardinality(@usr.id)"

# Max duration by service in the last 4 hours
pup traces aggregate --query="*" --compute="max(@duration)" --group-by="service" --from="4h"
```

## Query Syntax Reference

### `@` Prefix Rule

Span fields live at two levels in the response. The query prefix must match:

- **Top-level attributes** (`attributes.*`) — query **without** `@`: `service`, `status`, `resource_name`, `env`, `trace_id`, `parent_id`, `span_id`, `operation_name`
- **Custom attributes** (`attributes.custom.*`) — query **with** `@`: `@duration`, `@http.status_code`, `@span.kind`, `@peer.service`, `@error.type`, `@error.message`

Using the wrong prefix returns zero results silently. For example, `@parent_id` returns nothing — use `parent_id`.

### Top-Level Attributes (no `@`)

| Query | Description |
|-------|-------------|
| `service:<name>` | Filter by service |
| `resource_name:<path>` | Filter by endpoint |
| `env:production` | Filter by environment |
| `status:error` | Error spans only |
| `operation_name:<op>` | Filter by operation |
| `trace_id:<id>` | Look up all spans in a specific trace |
| `parent_id:<span_id>` | Find child spans of a specific span |

### Custom Attributes (with `@`)

| Query | Description |
|-------|-------------|
| `@duration:>5s` | Duration filter (supports shorthand: `5s`, `100ms`) |
| `@http.status_code:>=500` | Filter by HTTP status code |
| `@span.kind:server` | Inbound requests (this service is the callee) |
| `@span.kind:client` | Outbound calls (this service is the caller) |
| `@peer.service:<name>` | Filter by downstream service being called |
| `@error.type:<type>` | Filter by error type (e.g., `ETIMEDOUT`, `ECONNRESET`) |
| `@error.message:<text>` | Filter by error message |
| `@events:*` | Spans that have span events (exceptions, custom events) |

### Span Kinds

| Kind | Meaning |
|------|---------|
| `server` | Inbound request — the service received and handled this call |
| `client` | Outbound call — the service made this call to a downstream dependency |
| `unspecified` | Application wrapper spans (e.g., SDK-level spans that mirror underlying client/server spans). These are often duplicates — do not double-count with client/server spans. |

**Distinguishing error origin vs propagation:** If a service has mostly `client` errors and few `server` errors, it is a victim of downstream failures, not the source. Compare server error count vs client error count to determine whether a service originates errors or propagates them.

### Span Events

Spans can carry OpenTelemetry span events — most commonly `exception` events. Use `@events:*` to find spans with events. The `events` field is a JSON string containing an array with:
- `name` — event type (e.g., `exception`)
- `attributes.exception.message` — error message
- `attributes.exception.stacktrace` — full stack trace
- `attributes.exception.type` — exception class/type
- `time_unix_nano` — when the event occurred

Error spans with events also include `error.message`, `error.stack`, `error.file`, `error.fingerprint`, and error tracking fields (`issue.id`, `issue.age`, `issue.first_seen`). Use jq to extract: `pup traces search --query="status:error @events:*" | jq '.data.data[].attributes.custom.error'`

**GraphQL services:** GraphQL resolvers often return HTTP 200 while carrying errors in span events. For GraphQL services, always use `@events:*` alongside `status:error` — the HTTP status code alone misses resolver-level failures. Common GraphQL error types include `GQLError` (business logic / resolver errors), `INTERNAL_SERVER_ERROR`, and `RESOURCE_NOT_FOUND`. Resource names follow patterns like `graphql.resolve <resolver>` and `graphql-resolver-error`.

### jq Tips for Aggregate Results

When using `--group-by` with a `@`-prefixed facet, the key in the result retains the `@` prefix. Use bracket notation in jq:
```bash
# Correct — bracket notation for @ keys
pup traces aggregate --query="..." --compute="count" --group-by="@error.type" | \
  jq '.data.data[] | {error_type: .attributes.by["@error.type"], count: .attributes.compute.c0}'

# Wrong — dot notation doesn't work for @ keys
# .attributes.by.@error.type  ← jq syntax error
```

The `events` field is a JSON string with unescaped control characters (newlines in stack traces). Parsing it with `jq`'s `fromjson` may fail. Instead, extract error details from the structured `error.*` fields:
```bash
pup traces search --query="status:error @events:*" --limit=5 | \
  jq '.data.data[] | {resource: .attributes.resource_name, error_type: .attributes.custom.error.type, error_message: .attributes.custom.error.message, num_events: .attributes.custom.span_events}'
```

## Workflows

### Get a Trace by ID
```bash
# Look up all spans belonging to a specific trace
pup traces search --query="trace_id:abc123def456"

# Look up only the error spans in a trace
pup traces search --query="trace_id:abc123def456 status:error" --limit=100
```

### Determine Error Origin (Server vs Client)
```bash
# 1. Break down errors by span kind to see if errors are inbound or outbound
pup traces aggregate --query="service:myservice status:error" --compute="count" --group-by="@span.kind" --from="5h"

# 2. If mostly client errors — find which downstream services are failing
pup traces aggregate --query="service:myservice status:error @span.kind:client" --compute="count" --group-by="@peer.service" --from="5h"

# 3. If mostly server errors — find which endpoints are failing
pup traces aggregate --query="service:myservice status:error @span.kind:server" --compute="count" --group-by="resource_name" --from="5h"
```

### Trace the Failure Chain to Root Cause
```bash
# 1. Get an error span from the service
pup traces search --query="service:myservice status:error" --from="5h" --limit=1

# 2. Extract its span_id, then find its error children by parent_id
pup traces search --query="parent_id:<span_id> status:error" --from="5h" --limit=1

# 3. Repeat — take that child's span_id, search for its error children
pup traces search --query="parent_id:<child_span_id> status:error" --from="5h" --limit=1

# 4. Keep going until no results — the last span with results is the root cause
```

**Important:** Use `parent_id` without the `@` prefix. `@parent_id` does not work — it is not an indexed custom attribute. The same applies to `trace_id`, `service`, `status`, and other top-level span fields (no `@` prefix).

You can also use the aggregate approach to confirm which service is the root cause:
```bash
# Compare server vs client errors — a service with mostly server errors is the origin
pup traces aggregate --query="service:suspect-svc status:error" --compute="count" --group-by="@span.kind" --from="5h"
```

### Search Then Aggregate to Validate Findings
```bash
# 1. Search to find error spans and identify patterns
pup traces search --query="service:api status:error" --from="1h"

# 2. Aggregate to confirm the scale of the problem
pup traces aggregate --query="service:api status:error" --compute="count" --from="1h"

# 3. Break down errors by resource to find the hotspot
pup traces aggregate --query="service:api status:error" --compute="count" --group-by="resource_name" --from="1h"

# 4. Check latency impact on the affected resource
pup traces aggregate --query="service:api resource_name:\"GET /api/checkout\"" --compute="percentile(@duration, 99)" --from="1h"
```

### Find Upstream Callers Affected by a Failing Service
```bash
# Which services are calling myservice and getting errors?
pup traces aggregate --query="@peer.service:myservice status:error" --compute="count" --group-by="service" --from="5h"
```
