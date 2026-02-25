# SLOs: Reading (Listing and Getting Service Level Objectives)

## Commands

### List All SLOs

```bash
pup slos list
```

No flags. Retrieves all SLOs with current status, error budget, and compliance.

```bash
pup slos list
pup slos list --output=table
pup slos list > slos.json
```

**Output fields** (each SLO in `data[]`):

| Field | Description |
|-------|-------------|
| `id` | SLO ID (format: `xxx-xxx-xxx`) |
| `name` | SLO name |
| `description` | SLO description |
| `type` | `"metric"`, `"monitor"`, or `"time_slice"` |
| `type_id` | `0` (metric), `1` (monitor), `2` (time_slice) |
| `tags` | SLO tags |
| `thresholds` | Array of target definitions |
| `status` | Current SLO status |
| `created_at` | Creation timestamp |
| `modified_at` | Last modification timestamp |
| `creator` | User who created the SLO |
| `monitor_ids` | Associated monitor IDs (monitor-based SLOs) |

**Threshold fields** (each in `thresholds[]`):
- `target` - target percentage (e.g., `99.9`)
- `target_display` - display string (e.g., `"99.9%"`)
- `timeframe` - target window (`7d`, `30d`, `90d`)
- `warning` - optional warning threshold

**Status fields**:
- `state` - `"ok"`, `"breaching"`, or `"no_data"`
- `error_budget_remaining` - percentage of error budget remaining
- `sli_value` - current SLI value

**Filtering with jq**:
```bash
# Find breaching SLOs
pup slos list | jq '.data[] | select(.status.state == "breaching")'

# SLOs with high error budget remaining
pup slos list | jq '.data[] | select(.status.error_budget_remaining > 50)'

# Filter by tag
pup slos list | jq '.data[] | select(.tags[] | contains("team:backend"))'

# Extract names and states
pup slos list | jq '[.data[] | {name: .name, state: .status.state, budget: .status.error_budget_remaining}]'

# Find SLOs by name
pup slos list | jq '.data[] | select(.name | contains("API"))'

# Check error budget for all SLOs
pup slos list | jq '[.data[] | {name: .name, error_budget: .status.error_budget_remaining}]'
```

### Get SLO Details

```bash
pup slos get <slo-id>
```

Requires the SLO ID as a positional argument.

```bash
pup slos get abc-123-def
pup slos get abc-123-def > slo-backup.json
```

**Full output structure** (in `data`):

| Field | Description |
|-------|-------------|
| `id` | SLO ID |
| `name` | SLO name |
| `description` | Detailed description |
| `type` | `"metric"`, `"monitor"`, or `"time_slice"` |
| `query` | SLO query definition (metric-based) |
| `monitor_ids` | Monitor IDs (monitor-based) |
| `monitor_search` | Monitor query (monitor-based) |
| `groups` | Grouping dimensions |
| `tags` | SLO tags |
| `thresholds` | Target definitions with timeframes |
| `created_at`, `modified_at` | Timestamps |
| `creator` | Creator information |
| `team_tags` | Team ownership tags |

**Query fields** (metric-based SLOs):
- `query.numerator` - good events query
- `query.denominator` - total events query

**Status fields**:
- `state` - current state
- `sli_value` - current SLI percentage
- `error_budget_remaining` - remaining error budget %
- `error_budget_burn_rate` - current burn rate

**Extracting specific data**:
```bash
# Check error budget
pup slos get abc-123-def | jq '.data.status.error_budget_remaining'

# Get current SLI value
pup slos get abc-123-def | jq '.data.status.sli_value'

# View target thresholds
pup slos get abc-123-def | jq '.data.thresholds'

# Get the SLO query (metric-based)
pup slos get abc-123-def | jq '.data.query'
```

## SLO Types

| Type | ID | Description |
|------|----|-------------|
| Metric-based | `0` | Based on metric queries (e.g., success rate, latency) |
| Monitor-based | `1` | Based on monitor uptime |
| Time slice | `2` | Based on time slices meeting criteria |

## Calculation Methods

| Method | Description |
|--------|-------------|
| `by_count` | Count of good events / total events |
| `by_uptime` | Percentage of time in good state |

## Target Windows

| Window | Description |
|--------|-------------|
| `7d` | 7-day rolling window |
| `30d` | 30-day rolling window |
| `90d` | 90-day rolling window |

## Error Budget

Error budget = `(1 - target) * time_window`

| Target | Window | Allowed Downtime |
|--------|--------|-----------------|
| 99.9% | 30 days | 43.2 minutes |
| 99.95% | 30 days | 21.6 minutes |
| 99.99% | 30 days | 4.32 minutes |
| 99.9% | 7 days | 10.1 minutes |

## SLO States

| State | Meaning |
|-------|---------|
| `ok` | SLO is meeting target |
| `breaching` | SLO has breached target (error budget exhausted) |
| `no_data` | No data available to calculate SLO |

## Workflows

### Service Health Check
```bash
# Quick overview of all SLO states
pup slos list | jq '[.data[] | {name: .name, state: .status.state, sli: .status.sli_value, budget_remaining: .status.error_budget_remaining}]'
```

### Find At-Risk SLOs
```bash
# SLOs with less than 20% error budget remaining
pup slos list | jq '[.data[] | select(.status.error_budget_remaining < 20) | {name: .name, budget: .status.error_budget_remaining}]'
```

### Investigate a Breaching SLO
```bash
# 1. Get full SLO details
pup slos get abc-123-def

# 2. Check the underlying query
pup slos get abc-123-def | jq '.data.query'

# 3. Check associated monitors (monitor-based SLOs)
pup slos get abc-123-def | jq '.data.monitor_ids'

# 4. Query the metrics directly
pup metrics query --query="<numerator-query>" --from="1h"
```
