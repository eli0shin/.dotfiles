# RUM: Reading (Querying Real User Monitoring Data)

## Commands

### List RUM Applications

```bash
pup rum apps list
```

No flags. Returns all RUM applications.

**Auth note**: RUM apps API does not support OAuth. Requires API keys: `DD_API_KEY` + `DD_APP_KEY`.

```bash
pup rum apps list
pup rum apps list --output=table
```

### Get RUM Application Details

```bash
pup rum apps get --app-id="<app-id>"
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--app-id` | Yes | | RUM application ID |

```bash
pup rum apps get --app-id="abc-123-def"
```

**Auth note**: Requires API keys (no OAuth support).

### List RUM Sessions

```bash
pup rum sessions list [--from="<time>"] [--to="<time>"] [--limit=N]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--from` | No | `1h` | Start time |
| `--to` | No | `now` | End time |
| `--limit` | No | `100` | Maximum results |

Uses the RUM search events API. Returns RUM events (views, actions, errors, etc.) within the time range.

```bash
# List recent sessions
pup rum sessions list --from="1h"

# Last 24 hours, more results
pup rum sessions list --from="24h" --limit=200
```

### Search RUM Sessions

```bash
pup rum sessions search --query="<query>" [--from="<time>"] [--to="<time>"] [--limit=N]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--query` | Yes | | RUM search query |
| `--from` | No | `1h` | Start time |
| `--to` | No | `now` | End time |
| `--limit` | No | `100` | Maximum results |

```bash
# Search for error events
pup rum sessions search --query="@type:error" --from="1h"

# Find slow page loads (>3 seconds)
pup rum sessions search --query="@view.loading_time:>3000" --from="1h"

# Real user sessions only (not synthetic)
pup rum sessions search --query="@session.type:user" --from="1h"

# Filter by application
pup rum sessions search --query="@application.id:abc-123" --from="1h"

# Combine filters
pup rum sessions search --query="@type:error AND @application.id:abc-123" --from="2h" --limit=50
```

### RUM Query Syntax

| Query | Description |
|-------|-------------|
| `@type:error` | Error events |
| `@type:view` | Page view events |
| `@type:action` | User action events (clicks, taps) |
| `@type:resource` | Network request events |
| `@type:long_task` | Long task events (performance bottlenecks) |
| `@view.loading_time:>3000` | Slow page loads (milliseconds) |
| `@session.type:user` | Real user sessions (not synthetic) |
| `@application.id:<id>` | Filter by application |
| `@session.id:<id>` | Filter by session |
| `@error.message:<text>` | Filter by error message |
| `@view.url_path:<path>` | Filter by URL path |
| `@geo.country:<code>` | Filter by country |
| `@device.type:<type>` | Filter by device type (desktop, mobile, tablet) |

### List RUM Custom Metrics

```bash
pup rum metrics list
```

No flags. Returns all configured RUM custom metrics.

### Get RUM Custom Metric

```bash
pup rum metrics get --metric-id="<metric-id>"
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--metric-id` | Yes | | Metric ID |

### List Retention Filters

```bash
pup rum retention-filters list
```

### Get Retention Filter

```bash
pup rum retention-filters get --filter-id="<filter-id>"
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--filter-id` | Yes | | Filter ID |

### List Session Replay Playlists

```bash
pup rum playlists list
```

**NOT IMPLEMENTED** - returns error. Playlist API not available in current API client.

### Get Playlist Details

```bash
pup rum playlists get --playlist-id="<id>"
```

**NOT IMPLEMENTED** - returns error.

### Query Heatmap Data

```bash
pup rum heatmaps query --view="<page>" [--from="<time>"] [--to="<time>"]
```

**NOT IMPLEMENTED** - returns error.

## RUM Data Types

| Type | Description |
|------|-------------|
| Views | Page views and screen loads |
| Actions | User interactions (clicks, taps, scrolls) |
| Errors | Frontend errors and crashes |
| Resources | Network requests and asset loading |
| Long Tasks | Performance bottlenecks (>50ms main thread tasks) |

## Application Types

| Type | Description |
|------|-------------|
| `browser` | Web applications |
| `ios` | iOS mobile applications |
| `android` | Android mobile applications |
| `react-native` | React Native applications |
| `flutter` | Flutter applications |

## Workflows

### Investigate User Session Issues
```bash
# 1. Search for error sessions
pup rum sessions search --query="@type:error" --from="1h"

# 2. Find sessions with specific errors
pup rum sessions search --query="@error.message:*timeout*" --from="4h"

# 3. Check slow pages
pup rum sessions search --query="@view.loading_time:>5000" --from="1h"
```

### Frontend Performance Analysis
```bash
# 1. Find slow page loads
pup rum sessions search --query="@type:view AND @view.loading_time:>3000" --from="1h"

# 2. Check for long tasks
pup rum sessions search --query="@type:long_task" --from="1h"

# 3. Analyze resource loading
pup rum sessions search --query="@type:resource AND @resource.duration:>2000" --from="1h"
```

### Application Error Tracking
```bash
# 1. List RUM apps to get app IDs
pup rum apps list

# 2. Search for errors in a specific app
pup rum sessions search --query="@type:error AND @application.id:<app-id>" --from="4h"

# 3. Filter by error type
pup rum sessions search --query="@type:error AND @error.source:network" --from="1h"
```

### Geographic/Device Analysis
```bash
# Sessions from a specific country
pup rum sessions search --query="@geo.country:US" --from="1h"

# Mobile-only sessions
pup rum sessions search --query="@device.type:mobile" --from="1h"

# Errors on specific browser
pup rum sessions search --query="@type:error AND @browser.name:Chrome" --from="4h"
```
