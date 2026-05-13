# Notebooks: Reading (Listing and Getting Notebooks)

## Commands

### List Notebooks

```bash
pup notebooks list
```

No flags. Returns all notebooks.

**Auth note**: Requires API keys (`DD_API_KEY` + `DD_APP_KEY`). OAuth is not supported for notebook endpoints.

```bash
pup notebooks list
pup notebooks list --output=table
pup notebooks list > notebooks.json
```

### Get Notebook Details

```bash
pup notebooks get <notebook-id>
```

Requires a numeric notebook ID as a positional argument.

```bash
pup notebooks get 12345
pup notebooks get 12345 > notebook-backup.json
```

**Output structure**: Returns the full notebook definition including:
- Notebook metadata (name, author, timestamps)
- Cells/content (graphs, text, log streams, etc.)
- Time configuration
- Template variables

## Notebooks Overview

Notebooks combine graphs, logs, and narrative text for:
- **Investigations**: Document incident findings with live data
- **Postmortems**: Create reports with embedded metrics and logs
- **Runbooks**: Step-by-step procedures with live dashboards
- **Knowledge sharing**: Document monitoring patterns and practices

## Workflows

### Find Notebooks for an Investigation
```bash
# List all notebooks
pup notebooks list

# Filter by name with jq (if output includes title/name field)
pup notebooks list | jq '.data[] | select(.attributes.name | test("incident"; "i"))'
```

### Back Up a Notebook
```bash
# Save full notebook definition
pup notebooks get 12345 > notebook-12345-backup.json
```

### List Recent Notebooks
```bash
# List and sort by modification time
pup notebooks list | jq '[.data[] | {id: .id, name: .attributes.name, modified: .attributes.modified}] | sort_by(.modified) | reverse'
```
