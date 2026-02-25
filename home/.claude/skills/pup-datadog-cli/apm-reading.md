# APM: Reading (Querying Application Performance Monitoring Data)

APM provides dynamic operational data about traced services, datastores, queues, and other runtime entities. This is distinct from `service-catalog` which manages static metadata (ownership, docs).

**Important**: APM commands use Unix timestamps in seconds for `--start`/`--end`/`--from`/`--to` flags. They do NOT support relative time strings like `1h` or `30m`.

## Commands

### List APM Services

```bash
pup apm services list --env=<env> [--start=<unix>] [--end=<unix>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--env` | Yes | | Environment filter (e.g., `prod`, `staging`) |
| `--start` | No | 1 hour ago | Start time (Unix timestamp seconds) |
| `--end` | No | now | End time (Unix timestamp seconds) |

```bash
# List services in production
pup apm services list --env=prod

# Custom time range
pup apm services list --env=prod --start=$(date -v-2H +%s) --end=$(date +%s)
```

### Get Service Performance Stats

```bash
pup apm services stats --start=<unix> --end=<unix> [--env=<env>] [--primary-tag=<tag>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--start` | Yes | | Start time (Unix timestamp seconds) |
| `--end` | Yes | | End time (Unix timestamp seconds) |
| `--env` | No | | Environment filter |
| `--primary-tag` | No | | Primary tag filter (format: `group:value`) |

Returns per-service performance metrics: request rate, error rate, latency percentiles (p50, p75, p90, p95, p99), max latency.

```bash
# Service stats for the last hour
pup apm services stats --start=$(date -v-1H +%s) --end=$(date +%s)

# Filter by environment
pup apm services stats --start=$(date -v-1H +%s) --end=$(date +%s) --env=prod

# Filter by primary tag
pup apm services stats --start=$(date -v-1H +%s) --end=$(date +%s) --primary-tag="team:backend"
```

### List Operations for a Service

```bash
pup apm services operations <service> --start=<unix> --end=<unix> [--env=<env>] [--primary-tag=<tag>] [--primary-only]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `<service>` | Yes (positional) | | Service name |
| `--start` | Yes | | Start time (Unix timestamp seconds) |
| `--end` | Yes | | End time (Unix timestamp seconds) |
| `--env` | No | | Environment filter |
| `--primary-tag` | No | | Primary tag filter |
| `--primary-only` | No | `false` | Only return primary operations |

Operations represent different types of work: HTTP requests, database queries, cache operations, etc.

```bash
# List all operations for a service
pup apm services operations web-server --start=$(date -v-1H +%s) --end=$(date +%s)

# Filter by environment
pup apm services operations web-server --start=$(date -v-1H +%s) --end=$(date +%s) --env=prod

# Only primary operations
pup apm services operations web-server --start=$(date -v-1H +%s) --end=$(date +%s) --primary-only
```

**Output fields**: operation name, service name, span kind (server/client/producer/consumer/internal), type (web/db/cache/custom).

### List Resources (Endpoints) for a Service

```bash
pup apm services resources <service> --operation="<op>" --from=<unix> --to=<unix> [--env=<env>] [--peer-service=<svc>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `<service>` | Yes (positional) | | Service name |
| `--operation` | Yes | | Operation name |
| `--from` / `-f` | Yes | | Start time (Unix timestamp seconds) |
| `--to` / `-t` | Yes | | End time (Unix timestamp seconds) |
| `--env` | No | | Environment filter |
| `--primary-tag` | No | | Primary tag filter |
| `--peer-service` | No | | Peer service filter |

Resources are specific endpoints or queries within an operation (e.g., `GET /api/users`, `SELECT FROM users`).

```bash
# List endpoints for a service operation
pup apm services resources web-server \
  --operation="GET /api/users" \
  --from=$(date -v-1H +%s) --to=$(date +%s)

# Filter by environment
pup apm services resources web-server \
  --operation="GET /api/users" \
  --from=$(date -v-1H +%s) --to=$(date +%s) \
  --env=prod

# Filter by peer service (what it calls)
pup apm services resources web-server \
  --operation="GET /api/users" \
  --from=$(date -v-1H +%s) --to=$(date +%s) \
  --peer-service="database"
```

### Query APM Entities

```bash
pup apm entities list --start=<unix> --end=<unix> [--env=<env>] [--types=<types>] [--include=<fields>] [--limit=N] [--offset=N]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--start` | Yes | | Start time (Unix timestamp seconds) |
| `--end` | Yes | | End time (Unix timestamp seconds) |
| `--env` | No | | Environment filter |
| `--primary-tag` | No | | Primary tag filter |
| `--types` | No | | Comma-separated entity types |
| `--include` | No | | Comma-separated fields to include |
| `--limit` | No | `50` | Max results |
| `--offset` | No | `0` | Pagination offset |

**WARNING**: Uses an unstable API endpoint that may change or require feature flag enablement.

**Entity types**: `service`, `datastore`, `queue`, `inferred`

**Include fields**: `stats` (performance), `health` (health status), `incidents` (related incidents)

```bash
# List all entities
pup apm entities list --start=$(date -v-1H +%s) --end=$(date +%s)

# Services only with stats
pup apm entities list --start=$(date -v-1H +%s) --end=$(date +%s) --types=service --include=stats,health

# Datastores in production
pup apm entities list --start=$(date -v-1H +%s) --end=$(date +%s) --env=prod --types=datastore

# Paginate through results
pup apm entities list --start=$(date -v-1H +%s) --end=$(date +%s) --limit=10 --offset=10
```

### List Service Dependencies

```bash
pup apm dependencies list [service] --env=<env> --start=<unix> --end=<unix> [--primary-tag=<tag>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `[service]` | No (positional) | | Optional service name (omit for all) |
| `--env` | Yes | | Environment filter |
| `--start` | Yes | | Start time (Unix timestamp seconds) |
| `--end` | Yes | | End time (Unix timestamp seconds) |
| `--primary-tag` | No | | Primary tag filter |

Shows what services call other services, based on actual trace data.

```bash
# All service dependencies in production
pup apm dependencies list --env=prod --start=$(date -v-1H +%s) --end=$(date +%s)

# Dependencies for a specific service
pup apm dependencies list web-server --env=prod --start=$(date -v-1H +%s) --end=$(date +%s)
```

**Output**:
- All dependencies: map of `service -> {calls: [...], called_by: [...]}`
- Specific service: `{name: "service", calls: [...], called_by: [...]}`

### View Service Flow Map

```bash
pup apm flow-map --query="<query>" --from=<unix> --to=<unix> [--limit=N]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--query` | Yes | | Query filter (e.g., `env:prod`) |
| `--from` / `-f` | Yes | | Start time (Unix timestamp seconds) |
| `--to` / `-t` | Yes | | End time (Unix timestamp seconds) |
| `--limit` | No | `100` | Max nodes to return |

Returns nodes (services) and edges (calls) with performance metrics.

```bash
# Flow map for production
pup apm flow-map --query="env:prod" --from=$(date -v-1H +%s) --to=$(date +%s)

# Focus on a specific service
pup apm flow-map --query="env:prod service:web-server" --from=$(date -v-1H +%s) --to=$(date +%s)

# Limit graph size
pup apm flow-map --query="env:prod" --from=$(date -v-1H +%s) --to=$(date +%s) --limit=50
```

**Output**: Nodes with service metrics. Edges with hits/sec, error rate, latency percentiles (p50-p99), max latency.

## Workflows

### Performance Investigation
```bash
# 1. Get service stats to identify slow services
pup apm services stats --start=$(date -v-1H +%s) --end=$(date +%s) --env=prod

# 2. Drill into a specific service's operations
pup apm services operations web-server --start=$(date -v-1H +%s) --end=$(date +%s) --env=prod

# 3. Find the hot endpoints
pup apm services resources web-server \
  --operation="servlet.request" \
  --from=$(date -v-1H +%s) --to=$(date +%s) --env=prod

# 4. Check what it depends on
pup apm dependencies list web-server --env=prod --start=$(date -v-1H +%s) --end=$(date +%s)
```

### Service Dependency Mapping
```bash
# 1. Get the full dependency graph
pup apm dependencies list --env=prod --start=$(date -v-1H +%s) --end=$(date +%s)

# 2. Visualize with flow map
pup apm flow-map --query="env:prod" --from=$(date -v-1H +%s) --to=$(date +%s)
```

### Entity Discovery
```bash
# 1. Find all datastores in production
pup apm entities list --start=$(date -v-1H +%s) --end=$(date +%s) --env=prod --types=datastore --include=stats

# 2. Find all queues
pup apm entities list --start=$(date -v-1H +%s) --end=$(date +%s) --types=queue --include=stats

# 3. Find inferred external services
pup apm entities list --start=$(date -v-1H +%s) --end=$(date +%s) --types=inferred
```

### Compare Service Health Across Environments
```bash
# Production stats
pup apm services stats --start=$(date -v-1H +%s) --end=$(date +%s) --env=prod

# Staging stats
pup apm services stats --start=$(date -v-1H +%s) --end=$(date +%s) --env=staging
```
