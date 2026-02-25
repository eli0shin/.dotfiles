# Monitors: Reading (Listing, Searching, and Getting Monitors)

## Commands

### List Monitors

```bash
pup monitors list [--name="<text>"] [--tags="<tags>"] [--limit=N]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--name` | No | | Filter by monitor name (substring match) |
| `--tags` | No | | Filter by tags (comma-separated, e.g., `env:prod,team:backend`) |
| `--limit` | No | `200` | Max monitors to return (max `1000`; agent mode defaults to `500`) |

Returns a **limited** number of results - not all monitors. Use filters to find specific monitors.

**Examples**:
```bash
# List up to 200 monitors (default)
pup monitors list

# Find monitors with "CPU" in the name
pup monitors list --name="CPU"

# Find production monitors
pup monitors list --tags="env:production"

# Find monitors for a specific team
pup monitors list --tags="team:backend"

# Combine name and tag filters
pup monitors list --name="Database" --tags="env:production"

# Get up to 1000 monitors (maximum)
pup monitors list --limit=1000

# Get only 50 monitors
pup monitors list --limit=50
```

**Output fields**: `id`, `name`, `type`, `query`, `message`, `tags`, `options` (thresholds, notify_no_data, etc.), `overall_state` (Alert/Warn/No Data/OK), `created`, `modified`.

When no monitors match, the command prints a helpful message suggesting filter adjustments.

### Get Monitor Details

```bash
pup monitors get <monitor-id>
```

Requires a numeric monitor ID as a positional argument.

```bash
pup monitors get 12345678
pup monitors get 12345678 --output=table
pup monitors get 12345678 > monitor-backup.json
```

**Output includes**:
- `id`, `name`, `type`, `query`
- `message` - alert notification text with @mentions
- `tags` - list of tags
- `options`:
  - `thresholds` - alert and warning thresholds
  - `notify_no_data` - whether to alert on no data
  - `no_data_timeframe` - minutes before no-data alert
  - `renotify_interval` - minutes between re-notifications
  - `timeout_h` - hours before auto-resolve
  - `include_tags` - whether to include tags in notifications
  - `require_full_window` - require full evaluation window
  - `new_group_delay` - seconds to wait for new group
- `overall_state` - current state
- `overall_state_modified` - when state last changed
- `created`, `creator`, `modified`

### Search Monitors

```bash
pup monitors search [--query="<text>"] [--page=N] [--per-page=N] [--sort="<field>,<dir>"]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--query` | No | | Search query string |
| `--page` | No | `0` | Page number |
| `--per-page` | No | `30` | Results per page |
| `--sort` | No | | Sort order (e.g., `name,asc`, `id,desc`) |

More flexible than `list` - supports advanced search syntax.

```bash
# Search by text
pup monitors search --query="database"

# Search with pagination
pup monitors search --query="cpu" --page=1 --per-page=50

# Search and sort
pup monitors search --query="memory" --sort="name,asc"
```

## Monitor Types

| Type | Description |
|------|-------------|
| `metric alert` | Alert on metric threshold |
| `log alert` | Alert on log query matches |
| `trace-analytics alert` | Alert on APM trace patterns |
| `composite` | Combine multiple monitors with boolean logic |
| `service check` | Alert on service check status |
| `event alert` | Alert on event patterns |
| `process alert` | Alert on process status |

## Monitor States

| State | Meaning |
|-------|---------|
| `OK` | Monitor condition is not met |
| `Alert` | Monitor threshold exceeded |
| `Warn` | Warning threshold exceeded |
| `No Data` | No data received for the monitor query |

## Workflows

### Find Alerting Monitors for a Service
```bash
# List monitors tagged with the service
pup monitors list --tags="service:api"

# Then filter for alerting ones with jq
pup monitors list --tags="service:api" | jq '[.[] | select(.overall_state == "Alert")]'
```

### Investigate a Specific Monitor
```bash
# Get full monitor config
pup monitors get 12345678

# Extract the query to understand what it checks
pup monitors get 12345678 | jq -r '.query'

# Check thresholds
pup monitors get 12345678 | jq '.options.thresholds'
```

### Audit Monitors for a Team
```bash
# List all monitors for a team
pup monitors list --tags="team:backend" --limit=500

# Extract names and states
pup monitors list --tags="team:backend" | jq '[.[] | {name: .name, state: .overall_state, id: .id}]'
```

### Find Monitors by Status
```bash
# Search for monitors in alert state
pup monitors search --query="status:Alert"

# Search for no-data monitors
pup monitors search --query="status:No Data"
```
