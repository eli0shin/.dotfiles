# Slash Commands

Slash commands are explicitly invoked prompts with argument support. Users type `/command-name args` to execute them.

## File Structure

Create markdown files in `commands/` directory:

```
commands/
├── my-command.md
├── another-command.md
└── deploy.md
```

Filename becomes command name: `/my-command`, `/another-command`, `/deploy`

## Command Format

```markdown
---
description: Brief description shown in /help
argument-hint: <required-arg> [optional-arg]
allowed-tools: [Read, Write, Bash]
model: sonnet
---

# Command Prompt

This prompt executes when user types /my-command.

Use arguments: $ARGUMENTS or $1, $2, $3
Reference files: @file.txt
Execute bash first: !git status
```

## Frontmatter Fields

**description** (optional):

- Shown in `/help` menu
- Brief explanation of what command does

**argument-hint** (optional):

- Shown during auto-completion
- Format: `<required> [optional]`
- Example: `<file-path> [function-name]`

**allowed-tools** (optional):

- Array of tool names
- Restricts available tools
- Example: `[Read, Bash]` for read-only commands

**model** (optional):

- Specific model to use
- Options: `haiku`, `sonnet`, `opus`
- Default: inherits session model

**disable-model-invocation** (optional):

- Set to `true` to prevent SlashCommand tool from executing
- For commands that should only expand prompts

## Argument Variables

**$ARGUMENTS** - All arguments as single string:

```markdown
Process these files: $ARGUMENTS
```

User types: `/command file1.ts file2.ts`
Expands to: `Process these files: file1.ts file2.ts`

**$1, $2, $3** - Individual positional arguments:

```markdown
Generate tests for: $1
Focus on function: $2
```

User types: `/command src/auth.ts validateUser`
Expands to:

```
Generate tests for: src/auth.ts
Focus on function: validateUser
```

## File References

**@filename** - Include file contents:

```markdown
Review this code:

@$1

Check for security issues.
```

## Bash Prefix

**!command** - Execute bash before prompt:

```markdown
---
description: Show git status and diff
---

!git status
!git diff --stat

Review the changes above and summarize.
```

## Examples

### Simple Command

```markdown
---
description: Review code for security issues
---

Review the provided code for security vulnerabilities following OWASP guidelines.

Focus on:

- SQL injection
- XSS
- Authentication issues
- Data exposure

Code: $ARGUMENTS
```

Usage: `/security-review src/auth.ts`

### Command with Multiple Arguments

```markdown
---
description: Generate tests for specified file
argument-hint: <file-path> [function-name]
allowed-tools: [Read, Write, Bash]
---

Generate comprehensive unit tests for: $1

Focus on function: $2

Include:

1. Happy path scenarios
2. Edge cases
3. Error conditions

Use Vitest framework.
```

Usage: `/generate-tests src/utils.ts calculateTotal`

### Command with File Reference

```markdown
---
description: Explain code functionality
argument-hint: <file-path>
allowed-tools: [Read]
model: haiku
---

Explain what this code does:

@$1

Provide:

- High-level summary
- Key functions
- Dependencies
- Usage examples
```

Usage: `/explain src/parser.ts`

### Command with Bash Execution

```markdown
---
description: Deploy to staging environment
argument-hint: [branch-name]
allowed-tools: [Bash, Read]
---

!git status
!git diff --stat
!git log -3 --oneline

Review the changes above.

Deployment target: staging
Branch: $1

If changes look good:

1. Run tests
2. Build project
3. Deploy to staging
4. Verify deployment
```

Usage: `/deploy feature/new-auth`

### Complex Workflow Command

```markdown
---
description: Start new feature development
argument-hint: <feature-name>
allowed-tools: [Bash, Read, Write]
---

!git checkout -b feature/$1
!git pull origin main

Starting development for feature: $1

Tasks:

1. Created feature branch: feature/$1
2. Synced with main branch
3. Ready for development

Next steps:

- Implement the feature
- Write tests
- Use /review when ready
- Use /deploy when done
```

Usage: `/start user-authentication`

### Review Command

```markdown
---
description: Comprehensive code review
allowed-tools: [Read, Bash, Grep, Glob]
model: opus
---

!git status
!git diff --stat

Running comprehensive code review:

1. Code quality and style
2. Test coverage
3. Security implications
4. Documentation updates
5. Commit message quality

Provide detailed feedback and approval recommendation.
```

Usage: `/review`

## Command Best Practices

### Use Clear Descriptions

```yaml
# Good
description: Generate unit tests for specified file

# Bad
description: Testing
```

### Provide Argument Hints

```yaml
argument-hint: <file-path> [test-type]
```

Helps users know what arguments to provide.

### Choose Appropriate Model

```yaml
model: haiku  # Fast, simple tasks
model: sonnet # Balanced (default)
model: opus   # Complex reasoning
```

### Restrict Tools When Possible

```yaml
# For read-only commands
allowed-tools: [Read, Grep, Glob]

# For analysis commands
allowed-tools: [Read, Bash, WebFetch]
```

## Testing Commands

1. **Install plugin** with commands
2. **Verify command appears** in `/help`
3. **Test with arguments**: `/command arg1 arg2`
4. **Test file references**: `/command @file.txt`
5. **Test bash execution** if using `!` prefix
6. **Verify tool restrictions** work

## Commands vs Skills

**Use Commands when:**

- User explicitly invokes with `/command`
- Simple prompt template
- User wants control over when it runs
- Single file, no supporting docs

**Use Skills when:**

- Claude should auto-discover based on context
- Complex workflow requiring multiple files
- Need supporting documentation
- Team needs standardized capability

## Plugin Namespace

Plugin commands can use namespace to avoid conflicts:

`/plugin-name:command-name`

Example: `/security:scan`, `/deploy:staging`

Configure in plugin.json:

```json
{
  "commands": "commands/"
}
```

Commands automatically available as both:

- `/command-name` (if no conflict)
- `/plugin-name:command-name` (always works)

## Troubleshooting

**Command not appearing:**

- Check `commands/` directory exists
- Verify `.md` file extension
- Check frontmatter YAML syntax
- Restart Claude Code

**Arguments not working:**

- Verify using `$ARGUMENTS` or `$1`, `$2`, etc.
- Check argument-hint matches expected args
- Test with different argument counts

**Bash commands failing:**

- Check `!` prefix is at line start
- Verify commands are valid
- Test commands independently in shell
- Check working directory

**File references not working:**

- Verify `@filename` syntax
- Check file exists
- Ensure Read tool allowed
