# Dashboards: Reading (Listing and Getting Dashboards)

## Commands

### List All Dashboards

```bash
pup dashboards list
```

No flags. Returns summary information for all dashboards, sorted by popularity (most viewed first).

```bash
pup dashboards list
pup dashboards list --output=table
pup dashboards list > dashboards.json
```

**Output fields**:

| Field | Description |
|-------|-------------|
| `id` | Dashboard ID (used for get/delete) |
| `title` | Dashboard title |
| `description` | Dashboard description |
| `author_handle` | Email of creator |
| `created_at` | Creation time (ISO 8601) |
| `modified_at` | Last modification time |
| `url` | Dashboard URL (relative path) |
| `is_read_only` | Whether dashboard is read-only |
| `layout_type` | `"ordered"` (timeboard) or `"free"` (screenboard) |
| `popularity` | Popularity score based on views |
| `tags` | Dashboard tags |

**Filtering with jq** (no built-in filter flags):
```bash
# Find dashboards by title
pup dashboards list | jq '.dashboards[] | select(.title | contains("API"))'

# Find dashboards by author
pup dashboards list | jq '.dashboards[] | select(.author_handle | contains("@example.com"))'

# List only timeboard dashboards
pup dashboards list | jq '[.dashboards[] | select(.layout_type == "ordered")]'

# Extract IDs and titles
pup dashboards list | jq '[.dashboards[] | {id: .id, title: .title}]'
```

### Get Dashboard Details

```bash
pup dashboards get <dashboard-id>
```

Requires the dashboard ID as a positional argument (format: `xxx-xxx-xxx`).

```bash
pup dashboards get abc-def-123
pup dashboards get abc-def-123 > dashboard-backup.json
pup dashboards get abc-def-123 | jq .
```

**Output structure**:

| Field | Description |
|-------|-------------|
| `id` | Dashboard ID |
| `title` | Dashboard title |
| `description` | Dashboard description |
| `layout_type` | `"ordered"` or `"free"` |
| `widgets` | Array of widget configurations |
| `template_variables` | Array of template variable definitions |
| `notify_list` | Users/teams to notify on changes |
| `reflow_type` | Reflow behavior (`"auto"` or `"fixed"`) |
| `created_at` | Creation timestamp |
| `modified_at` | Last modification timestamp |
| `author_handle` | Creator email |

**Widget structure** (each widget in `widgets[]`):
- `definition.type` - widget type (timeseries, query_value, toplist, table, heatmap, etc.)
- `definition.requests` - data queries (metrics, logs, traces)
- `definition.title` - widget title
- `definition.time` - time configuration
- `id` - widget ID
- `layout` - widget position and size

**Template variables** (each in `template_variables[]`):
- `name` - variable name (e.g., `"env"`, `"service"`)
- `prefix` - tag prefix (e.g., `"env"`)
- `default` - default value
- `available_values` - list of available values

**Extracting specific parts**:
```bash
# Get just the widgets
pup dashboards get abc-def-123 | jq '.widgets'

# Get dashboard title
pup dashboards get abc-def-123 | jq -r '.title'

# List widget types
pup dashboards get abc-def-123 | jq '[.widgets[].definition.type]'

# Get template variables
pup dashboards get abc-def-123 | jq '.template_variables'
```

## Dashboard Types

| Type | Layout | Description |
|------|--------|-------------|
| Timeboard | `ordered` | Grid-based layout with synchronized timeseries graphs |
| Screenboard | `free` | Flexible free-form layout with any widget placement |

## Widget Types

Common widget types found in dashboards:
- `timeseries` - line, area, or bar graphs over time
- `query_value` - single numeric value with thresholds
- `table` - tabular data
- `toplist` - top N values
- `heatmap` - heat map visualization
- `change` - value change over time
- `event_timeline` - event stream
- `free_text` - markdown text
- `group` - container for organizing widgets
- `note` - text annotations
- `service_map` - service dependency visualization

## Workflows

### Backup a Dashboard
```bash
# Save full configuration to file
pup dashboards get abc-def-123 > my-dashboard-backup.json
```

### Find Dashboards for a Service
```bash
# Search by title
pup dashboards list | jq '[.dashboards[] | select(.title | test("API|api"; "i")) | {id, title}]'
```

### Audit Dashboard Ownership
```bash
# List dashboards with authors
pup dashboards list | jq '[.dashboards[] | {title: .title, author: .author_handle, modified: .modified_at}]'
```
