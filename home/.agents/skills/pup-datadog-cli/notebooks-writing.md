# Notebooks: Writing (Creating, Updating, and Deleting Notebooks)

## Commands

### Create a Notebook

```bash
pup notebooks create --body @<filepath>
pup notebooks create --body -
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--body` | Yes | | JSON body: `@filepath` for file, `-` for stdin |

**Auth note**: Requires API keys (`DD_API_KEY` + `DD_APP_KEY`). OAuth is not supported.

The body must be valid JSON conforming to the Datadog NotebookCreateRequest schema.

```bash
# Create from a file
pup notebooks create --body @notebook.json

# Create from stdin
cat notebook.json | pup notebooks create --body -

# Create from a heredoc
pup notebooks create --body - <<'EOF'
{
  "data": {
    "attributes": {
      "name": "Investigation: API Latency Spike",
      "cells": [
        {
          "attributes": {
            "definition": {
              "type": "markdown",
              "text": "## API Latency Investigation\n\nInvestigating spike in API response times."
            }
          },
          "type": "notebook_cells"
        }
      ],
      "time": {
        "live_span": "1h"
      }
    },
    "type": "notebooks"
  }
}
EOF
```

### Notebook JSON Structure

```json
{
  "data": {
    "attributes": {
      "name": "Notebook Title",
      "cells": [
        {
          "attributes": {
            "definition": {
              "type": "markdown",
              "text": "## Section Title\nNarrative text here."
            }
          },
          "type": "notebook_cells"
        },
        {
          "attributes": {
            "definition": {
              "type": "timeseries",
              "requests": [
                {
                  "q": "avg:system.cpu.user{*}",
                  "display_type": "line"
                }
              ]
            }
          },
          "type": "notebook_cells"
        }
      ],
      "time": {
        "live_span": "1h"
      }
    },
    "type": "notebooks"
  }
}
```

**Cell types**:
- `markdown` - text content with markdown formatting
- `timeseries` - line/area/bar graphs
- `toplist` - top N values
- `heatmap` - heat map visualization
- `distribution` - distribution graph
- `log_stream` - live log stream
- `query_value` - single numeric value
- `table` - tabular data

### Update a Notebook

```bash
pup notebooks update <notebook-id> --body @<filepath>
pup notebooks update <notebook-id> --body -
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `<notebook-id>` | Yes (positional) | | Numeric notebook ID |
| `--body` | Yes | | JSON body: `@filepath` for file, `-` for stdin |

The body must be valid JSON conforming to the NotebookUpdateRequest schema.

```bash
# Update from file
pup notebooks update 12345 --body @updated-notebook.json

# Update from stdin
cat updated.json | pup notebooks update 12345 --body -
```

### Delete a Notebook

```bash
pup notebooks delete <notebook-id> [--yes]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `<notebook-id>` | Yes (positional) | | Numeric notebook ID |
| `--yes` / `-y` | No | `false` | Skip confirmation prompt |

```bash
# Delete with confirmation
pup notebooks delete 12345

# Delete without confirmation
pup notebooks delete 12345 --yes
```

**Confirmation behavior**:
- Without `--yes`: prompts `y/N`
- With `--yes`: skips prompt
- In agent mode: auto-approved
- With `DD_AUTO_APPROVE=true`: auto-approved

## Workflows

### Create an Investigation Notebook
```bash
# 1. Create a notebook for an incident investigation
pup notebooks create --body - <<'EOF'
{
  "data": {
    "attributes": {
      "name": "Incident Investigation - 2024-02-04",
      "cells": [
        {
          "attributes": {
            "definition": {
              "type": "markdown",
              "text": "## Incident Timeline\n\n- **Detected**: 10:00 UTC\n- **Impact**: API latency spike\n- **Services affected**: api-gateway, user-service"
            }
          },
          "type": "notebook_cells"
        },
        {
          "attributes": {
            "definition": {
              "type": "timeseries",
              "requests": [
                {
                  "q": "avg:trace.servlet.request.duration{service:api-gateway}",
                  "display_type": "line"
                }
              ]
            }
          },
          "type": "notebook_cells"
        }
      ],
      "time": {
        "live_span": "4h"
      }
    },
    "type": "notebooks"
  }
}
EOF
```

### Clone and Modify a Notebook
```bash
# 1. Export existing notebook
pup notebooks get 12345 > notebook-template.json

# 2. Modify the JSON (update name, cells, etc.)
# Edit notebook-template.json...

# 3. Create new notebook from modified template
pup notebooks create --body @notebook-template.json
```

### Safe Notebook Deletion
```bash
# 1. Back up the notebook first
pup notebooks get 12345 > notebook-12345-backup.json

# 2. Delete
pup notebooks delete 12345
```
