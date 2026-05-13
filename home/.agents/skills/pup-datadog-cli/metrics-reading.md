# Metrics: Reading (Querying and Listing Metrics)

## Commands

### Query Metrics (v2 Timeseries API)

```bash
pup metrics query --query="<query>" --from="<time>" [--to="<time>"]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--query` | Yes | | Metric query string |
| `--from` | No | `1h` | Start time (relative, absolute, or `now`) |
| `--to` | No | `now` | End time |

Uses the v2 Timeseries Formula API for structured time-series queries.

**Query syntax**: `<aggregation>:<metric_name>{<filter>} [by {<group>}]`

**Aggregations**: `avg`, `sum`, `min`, `max`, `count`

**Examples**:
```bash
# Average CPU usage across all hosts for the last hour
pup metrics query --query="avg:system.cpu.user{*}" --from="1h"

# Request count by service for last 4 hours
pup metrics query --query="sum:app.requests{env:prod} by {service}" --from="4h"

# Max memory usage for specific hosts
pup metrics query --query="max:system.mem.used{host:web-*}" --from="2h"

# Load average by host in a specific AZ
pup metrics query --query="avg:system.load.1{availability-zone:us-east-1a} by {host}" --from="1h"

# With absolute timestamps
pup metrics query --query="avg:system.load.1{*}" --from="1704067200" --to="1704153600"
```

**Output**: Returns time-series data with `series` (data points), `from_date`, `to_date`, `query`, `res_type`.

### Search Metrics (v1 API)

```bash
pup metrics search --query="<query>" --from="<time>" [--to="<time>"]
```

Same flags as `query`. Uses the v1 QueryMetrics API with classic query syntax. Use this for straightforward queries without v2 timeseries formula semantics.

```bash
pup metrics search --query="avg:system.cpu.user{*}" --from="1h"
pup metrics search --query="sum:app.requests{env:prod} by {service}" --from="4h"
```

### List Available Metrics

```bash
pup metrics list [--filter="<pattern>"] [--tag-filter="<tags>"]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--filter` | No | | Client-side name pattern (wildcards: `*`, `?`) |
| `--tag-filter` | No | | Server-side tag filter (comma-separated, e.g., `env:prod,service:api`) |

**Name filtering** (client-side, after fetch):
```bash
pup metrics list --filter="system.*"        # All system metrics
pup metrics list --filter="*.cpu.*"         # All CPU metrics
pup metrics list --filter="custom.*"        # All custom metrics
pup metrics list --filter="*request*"       # All metrics containing "request"
```

**Tag filtering** (server-side):
```bash
pup metrics list --tag-filter="env:prod"
pup metrics list --tag-filter="env:prod,service:api"   # AND logic
```

**Combined**:
```bash
pup metrics list --filter="system.*" --tag-filter="env:prod"
```

### Get Metric Metadata

```bash
pup metrics metadata get <metric-name>
```

Requires the metric name as a positional argument.

```bash
pup metrics metadata get system.cpu.user
pup metrics metadata get custom.api.latency
pup metrics metadata get system.cpu.user --output=table
```

**Output fields**: `description`, `unit`, `type` (gauge/count/rate/distribution), `per_unit`, `short_name`, `integration`, `statsd_interval`.

### List Metric Tags

```bash
pup metrics tags list <metric-name> [--from="<time>"] [--to="<time>"]
```

**NOTE**: This command is not functional in the current API client version. It returns an error.

## Metric Query Syntax Reference

```
<aggregation>:<metric_name>{<filter>} [by {<group>}]
```

| Component | Description | Examples |
|-----------|-------------|----------|
| Aggregation | How to combine values | `avg`, `sum`, `min`, `max`, `count` |
| Metric name | Dot-separated metric name | `system.cpu.user`, `app.requests` |
| Filter | Tag-based filter in braces | `{*}` (all), `{env:prod}`, `{host:web-*}` |
| Group by | Dimensions to split by | `by {host}`, `by {service,env}` |

**Filter operators**:
- `{*}` - match all
- `{env:prod}` - exact match
- `{host:web-*}` - wildcard
- `{env:prod,service:api}` - AND (multiple tags)

## Metric Types

| Type | Description | Example |
|------|-------------|---------|
| `gauge` | Point-in-time value | CPU usage, memory, temperature |
| `count` | Cumulative count | Request count, error count |
| `rate` | Rate of change per second | Requests per second |
| `distribution` | Statistical distribution | Latency percentiles |

## Workflows

### Compare Metrics Across Environments
```bash
# CPU usage in prod vs staging
pup metrics query --query="avg:system.cpu.user{env:prod}" --from="1h"
pup metrics query --query="avg:system.cpu.user{env:staging}" --from="1h"
```

### Find Available Metrics for a Service
```bash
# List metrics tagged with a service
pup metrics list --tag-filter="service:api"

# Then query specific ones
pup metrics query --query="avg:trace.servlet.request.duration{service:api}" --from="1h"
```

### Investigate Metric Metadata
```bash
# Check what a metric measures
pup metrics metadata get custom.api.latency

# List all custom metrics
pup metrics list --filter="custom.*"
```
