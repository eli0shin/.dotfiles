# Hooks

Hooks are shell commands that execute at specific lifecycle events. They can block operations, add context, or automate workflows.

## Hook Events

| Event            | When                  | Can Block | Typical Use                   |
| ---------------- | --------------------- | --------- | ----------------------------- |
| PreToolUse       | Before tool execution | Yes       | Validate input, protect files |
| PostToolUse      | After tool success    | No        | Format code, run tests        |
| UserPromptSubmit | User submits input    | Yes       | Validate prompts, logging     |
| SessionStart     | Session begins        | No        | Setup environment             |
| SessionEnd       | Session ends          | No        | Cleanup, save state           |
| Stop             | Agent finishes        | LLM only  | Validate completeness         |
| SubagentStop     | Subagent finishes     | LLM only  | Quality checks                |
| Notification     | Notification sent     | No        | Custom alerts                 |

## Configuration Format

Create `hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
            "timeout": 10000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Tool used'"
          }
        ]
      }
    ]
  }
}
```

## Matchers

**For PreToolUse/PostToolUse:**

- `"Edit"` - Exact match (case-sensitive)
- `"Edit|Write"` - Multiple tools (regex)
- `"*"` - All tools
- `"mcp__.*"` - All MCP tools
- `"mcp__server__.*"` - Specific MCP server

**For SessionStart:**

- `"startup"` - New session
- `"resume"` - Resumed session
- `"clear"` - After clear
- `"compact"` - After compact
- `"*"` - All session starts

## Hook Types

### Command Hooks

```json
{
  "type": "command",
  "command": "bash script.sh",
  "timeout": 60000
}
```

**Exit codes:**

- `0` - Success (stdout added to Claude's context)
- `2` - Blocking error (stderr shown to Claude, operation blocked)
- Other - Non-blocking error (shown to user)

### Prompt Hooks

Only for Stop/SubagentStop events:

```json
{
  "type": "prompt",
  "prompt": "Evaluate if the response is complete"
}
```

LLM returns JSON with decision fields.

## Hook Input (stdin)

All hooks receive JSON via stdin.

**Common fields:**

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "prompt"
}
```

**PreToolUse/PostToolUse additional:**

```json
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/path/to/file",
    "old_string": "...",
    "new_string": "..."
  },
  "tool_response": "..." // PostToolUse only
}
```

**UserPromptSubmit additional:**

```json
{
  "user_prompt": "The user's message"
}
```

**SessionStart additional:**

```json
{
  "session_trigger": "startup",
  "CLAUDE_ENV_FILE": "/path/to/env" // Write env vars here
}
```

## Extracting Data in Scripts

```bash
#!/bin/bash

# Read JSON from stdin
INPUT=$(cat)

# Extract fields
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // empty')
```

Or pipe directly:

```bash
#!/bin/bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
```

## Common Patterns

### File Type Filter

```bash
#!/bin/bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

# Only process TypeScript files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
  exit 0
fi

# Do something with TypeScript files
npx prettier --write "$FILE_PATH"
exit 0
```

### Block Protected Files

```bash
#!/bin/bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" == *".env"* ]] || [[ "$FILE_PATH" == *".git/"* ]]; then
  echo "Error: Cannot modify protected file: $FILE_PATH" >&2
  exit 2  # Block the operation
fi

exit 0
```

### Validate Content

```bash
#!/bin/bash
set -e

NEW_CONTENT=$(jq -r '.tool_input.new_string // empty')

# Check for secrets
if echo "$NEW_CONTENT" | grep -qi "API_KEY.*="; then
  echo "Error: Detected potential secret" >&2
  exit 2  # Block
fi

exit 0
```

### Format After Edit

```bash
#!/bin/bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  npx prettier --write "$FILE_PATH" 2>/dev/null || true
  echo "Formatted: $FILE_PATH"
fi

exit 0
```

### Session Setup

```bash
#!/bin/bash

# Add environment variables
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "MY_VAR=value" >> "$CLAUDE_ENV_FILE"
  echo "PATH=$PATH:${CLAUDE_PLUGIN_ROOT}/bin" >> "$CLAUDE_ENV_FILE"
fi

# Create directories
mkdir -p "${CLAUDE_PROJECT_DIR}/.plugin-data"

# Output added to Claude's context
echo "Plugin initialized"
exit 0
```

### Log Commands

```bash
#!/bin/bash
COMMAND=$(jq -r '.tool_input.command // empty')
LOG_FILE="${CLAUDE_PROJECT_DIR}/.command-history.log"

echo "$(date): $COMMAND" >> "$LOG_FILE"
exit 0
```

### Conditional Execution

```bash
#!/bin/bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

# Only run in src/ directory
if [[ "$FILE_PATH" != "${CLAUDE_PROJECT_DIR}/src/"* ]]; then
  exit 0
fi

# Only for .ts files
if [[ "$FILE_PATH" =~ \.ts$ ]]; then
  # Run TypeScript-specific checks
  npx tsc --noEmit "$FILE_PATH"
fi

exit 0
```

## Security

**Always validate input:**

```bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

# Prevent path traversal
if [[ "$FILE_PATH" == *".."* ]]; then
  echo "Invalid file path" >&2
  exit 2
fi
```

**Quote variables:**

```bash
# Good
cat "$FILE_PATH"

# Bad - vulnerable to injection
cat $FILE_PATH
```

**Check for dangerous patterns:**

```bash
PROTECTED=(".env" ".git/" "credentials" "secrets")

for pattern in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Cannot modify protected file" >&2
    exit 2
  fi
done
```

## Multiple Hooks

Multiple hooks can respond to the same event. They execute in parallel.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "script1.sh"
          },
          {
            "type": "command",
            "command": "script2.sh"
          }
        ]
      }
    ]
  }
}
```

## Debugging Hooks

**Enable debug mode:**

```bash
claude --debug
```

**View registered hooks:**
In Claude session: `/hooks`

**Test hook script directly:**

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"test.ts"}}' | ./script.sh
```

## Examples

### Auto-Formatter Plugin

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh"
          }
        ]
      }
    ]
  }
}
```

```bash
#!/bin/bash
# scripts/format.sh
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" =~ \.(js|jsx|ts|tsx|json|css|html|md)$ ]]; then
  prettier --write "$FILE_PATH" 2>/dev/null || true
fi

exit 0
```

### File Protection Plugin

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/protect.sh"
          }
        ]
      }
    ]
  }
}
```

```bash
#!/bin/bash
# scripts/protect.sh
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

PROTECTED=(".env" ".git/" "credentials.json" "private.key")

for pattern in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Error: Cannot modify protected file: $FILE_PATH" >&2
    exit 2
  fi
done

exit 0
```
