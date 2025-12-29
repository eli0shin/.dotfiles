# MCP Servers

MCP (Model Context Protocol) servers provide tool integrations for Claude Code. Plugins can bundle MCP servers to add custom tools.

## Configuration File

Create `.mcp.json` in plugin root:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/server.js"],
      "env": {
        "CONFIG_PATH": "${CLAUDE_PLUGIN_ROOT}/config.json",
        "API_KEY": "${API_KEY}"
      }
    }
  }
}
```

## Configuration Fields

**server-name** (key):

- Identifier for the server
- Tools will be named `mcp__server-name__tool-name`

**command** (required):

- Executable to run
- Examples: `node`, `python`, `npx`, `/path/to/binary`

**args** (required):

- Array of arguments
- Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths
- Use `${CLAUDE_PROJECT_DIR}` for project-relative paths

**env** (optional):

- Environment variables for the server
- Can reference system env vars: `${API_KEY}`
- Can use plugin paths: `${CLAUDE_PLUGIN_ROOT}/config`

## Environment Variables

**${CLAUDE_PLUGIN_ROOT}**:

- Absolute path to plugin directory
- Use for plugin-relative files

**${CLAUDE_PROJECT_DIR}**:

- Current project root directory
- Use for project-relative access

**${VAR_NAME}**:

- System environment variables
- Example: `${HOME}`, `${API_KEY}`

## Tool Naming

MCP tools follow pattern: `mcp__server-name__tool-name`

Example:

```json
{
  "mcpServers": {
    "filesystem": { ... }
  }
}
```

Tools become:

- `mcp__filesystem__read_file`
- `mcp__filesystem__write_file`
- `mcp__filesystem__list_directory`

## Examples

### Custom Server

```json
{
  "mcpServers": {
    "my-api": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/api-server.js"],
      "env": {
        "API_URL": "https://api.example.com",
        "API_KEY": "${MY_API_KEY}",
        "CONFIG": "${CLAUDE_PLUGIN_ROOT}/config/api.json"
      }
    }
  }
}
```

### Filesystem Server

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${CLAUDE_PROJECT_DIR}"
      ]
    }
  }
}
```

### GitHub Server

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Python Server

```json
{
  "mcpServers": {
    "data-processor": {
      "command": "python",
      "args": ["-m", "mcp_server", "${CLAUDE_PLUGIN_ROOT}/processors"],
      "env": {
        "PYTHONPATH": "${CLAUDE_PLUGIN_ROOT}/lib"
      }
    }
  }
}
```

### Multiple Servers

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${CLAUDE_PROJECT_DIR}"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "custom-api": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/custom.js"],
      "env": {
        "API_KEY": "${CUSTOM_API_KEY}"
      }
    }
  }
}
```

## Using MCP Tools in Hooks

Target MCP tools with regex matchers:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'MCP tool called'"
          }
        ]
      },
      {
        "matcher": "mcp__filesystem__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Filesystem operation'"
          }
        ]
      }
    ]
  }
}
```

## Server Development

### Basic MCP Server (Node.js)

```javascript
// servers/my-server.js
const { Server } = require('@modelcontextprotocol/sdk/server');
const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio');

const server = new Server({
  name: 'my-server',
  version: '1.0.0',
});

// Define tools
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'my_tool',
      description: 'Does something useful',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'my_tool') {
    // Implement tool logic
    return {
      content: [
        {
          type: 'text',
          text: `Processed: ${args.input}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);
```

### Python MCP Server

```python
# servers/my_server.py
from mcp.server import Server, stdio_server
from mcp.types import Tool, TextContent

app = Server("my-server")

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="my_tool",
            description="Does something useful",
            inputSchema={
                "type": "object",
                "properties": {
                    "input": {"type": "string"}
                },
                "required": ["input"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "my_tool":
        result = f"Processed: {arguments['input']}"
        return [TextContent(type="text", text=result)]
    raise ValueError(f"Unknown tool: {name}")

if __name__ == "__main__":
    stdio_server(app)
```

## Best Practices

### Use Plugin-Relative Paths

```json
{
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/servers/server.js"]
}
```

Not:

```json
{
  "command": "node",
  "args": ["./servers/server.js"] // Won't work
}
```

### Handle Environment Variables

```json
{
  "env": {
    "API_KEY": "${API_KEY}",
    "FALLBACK": "${API_KEY:-default-value}"
  }
}
```

### Use NPX for Published Packages

```json
{
  "command": "npx",
  "args": ["-y", "@scope/package-name"]
}
```

The `-y` flag auto-installs without prompting.

### Provide Configuration Files

```json
{
  "command": "node",
  "args": [
    "${CLAUDE_PLUGIN_ROOT}/server.js",
    "--config",
    "${CLAUDE_PLUGIN_ROOT}/config/server.json"
  ]
}
```

## Troubleshooting

**Server not starting:**

- Check `.mcp.json` syntax
- Verify command is executable: `which node`
- Test command manually
- Check environment variables are set

**Tools not appearing:**

- Verify server implements `tools/list` handler
- Check tool names follow MCP spec
- Restart Claude Code

**Server crashes:**

- Check server logs
- Verify all dependencies installed
- Test server independently
- Check environment variables

**Can't find server files:**

- Use `${CLAUDE_PLUGIN_ROOT}` for plugin files
- Use absolute paths in command
- Don't use relative paths like `./file`

## Plugin manifest.json Integration

Reference .mcp.json in plugin manifest:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "mcpServers": ".mcp.json"
}
```

Or inline:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"]
    }
  }
}
```

## Common MCP Servers

**Filesystem:**

```bash
@modelcontextprotocol/server-filesystem
```

**GitHub:**

```bash
@modelcontextprotocol/server-github
```

**PostgreSQL:**

```bash
@modelcontextprotocol/server-postgres
```

**Web Search:**

```bash
@modelcontextprotocol/server-brave-search
```

## Security Considerations

- Validate all tool inputs
- Don't expose sensitive data in tool responses
- Use environment variables for secrets
- Limit filesystem access scope
- Implement proper error handling
- Log security-relevant operations

## Testing MCP Servers

1. **Test server independently:**

   ```bash
   node servers/server.js
   # Should start without errors
   ```

2. **Install plugin** with MCP server

3. **Verify server started** - Check debug logs

4. **Test tool availability:**
   - Tools should be available as `mcp__server__tool`

5. **Test tool functionality:**
   - Use tools in Claude session
   - Verify expected behavior

6. **Check error handling:**
   - Test with invalid inputs
   - Verify graceful errors
