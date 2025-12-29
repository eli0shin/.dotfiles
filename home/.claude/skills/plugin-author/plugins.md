# Plugin Structure and Distribution

## Plugin Manifest (plugin.json)

Every plugin requires `.claude-plugin/plugin.json`.

**Required fields:**

```json
{
  "name": "plugin-name", // kebab-case, no spaces
  "version": "1.0.0", // Semantic versioning
  "description": "Brief description",
  "author": {
    "name": "Author Name"
  }
}
```

**Optional fields:**

```json
{
  "email": "email@example.com",
  "url": "https://example.com",
  "homepage": "https://docs.example.com",
  "repository": "https://github.com/user/repo",
  "license": "MIT",
  "keywords": ["tag1", "tag2"],
  "commands": "commands/", // Or array of paths
  "agents": "agents/", // Or array of paths
  "hooks": "hooks/hooks.json", // Or inline object
  "mcpServers": ".mcp.json" // Or inline object
}
```

## Directory Structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Required manifest
├── commands/                # Optional: slash commands
│   └── my-command.md
├── agents/                  # Optional: subagents
│   └── my-agent.md
├── skills/                  # Optional: agent skills
│   └── my-skill/
│       └── SKILL.md
├── hooks/                   # Optional: event hooks
│   └── hooks.json
├── .mcp.json               # Optional: MCP servers
├── scripts/                # Optional: helper scripts
└── README.md               # Recommended
```

## Marketplaces

Marketplaces are directories containing plugins and a manifest.

**Structure:**

```
my-marketplace/
├── .claude-plugin/
│   └── marketplace.json
├── plugin-1/
│   └── ...
└── plugin-2/
    └── ...
```

**marketplace.json:**

```json
{
  "name": "My Marketplace",
  "description": "Collection of plugins",
  "homepage": "https://github.com/user/marketplace",
  "plugins": [
    {
      "name": "plugin-1",
      "source": "plugin-1",
      "description": "First plugin"
    },
    {
      "name": "plugin-2",
      "source": "plugin-2",
      "description": "Second plugin"
    }
  ]
}
```

## Installation

**Add marketplace:**

```bash
claude plugins add /path/to/marketplace
# or
claude plugins add https://github.com/user/marketplace
```

**Install plugin:**

```bash
claude plugins install plugin-name
```

**Uninstall:**

```bash
claude plugins uninstall plugin-name
```

**List:**

```bash
claude plugins list
```

## Distribution Methods

**Git repository:**
Users install with: `claude plugins add https://github.com/user/marketplace`

**Local directory:**
For team-local: `claude plugins add /shared/company-plugins`

**Project-scoped:**
Add to `.claude/settings.json`:

```json
{
  "plugins": [
    {
      "name": "my-plugin",
      "marketplace": "https://github.com/user/marketplace"
    }
  ]
}
```

## Versioning

Follow semantic versioning:

- `0.x.x` - Development/alpha
- `1.0.0` - First stable release
- `1.x.x` - New features (backwards compatible)
- `x.x.1` - Bug fixes
- `2.0.0` - Breaking changes

## Environment Variables

Available in plugin configs (hooks.json, .mcp.json, scripts):

- `${CLAUDE_PLUGIN_ROOT}` - Absolute path to plugin directory
- `${CLAUDE_PROJECT_DIR}` - Current project root

**Example usage:**

```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/scripts/my-script.sh"
}
```
