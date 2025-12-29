# Agents (Subagents)

Agents are specialized subagents for handling specific tasks autonomously. They're defined in markdown files with frontmatter configuration.

## File Structure

Create markdown files in `agents/` directory:

```
agents/
├── deployment-agent.md
├── code-reviewer.md
└── security-scanner.md
```

## Agent Format

```markdown
---
name: agent-name
description: What the agent does and when to invoke
allowed-tools: [Read, Grep, Bash]
model: sonnet
---

# Agent Instructions

This agent specializes in specific tasks.

## Responsibilities

1. Task 1
2. Task 2
3. Task 3

## Process

1. Gather information
2. Process and analyze
3. Return structured results

## Output Format

Return results in this format:

- Summary
- Details
- Recommendations
```

## Frontmatter Fields

**name** (required):

- Agent identifier
- lowercase, hyphens only

**description** (required):

- Purpose and when to invoke
- Helps Claude decide when to delegate

**allowed-tools** (optional):

- Array of tool names
- Restricts available tools

**model** (optional):

- Specific model to use
- Options: `haiku`, `sonnet`, `opus`
- Use `haiku` for fast, simple tasks

## When to Use Agents

**Use agents for:**

- Specialized analysis tasks
- Complex multi-step processes
- Tasks requiring focused expertise
- Parallel execution of subtasks

**Don't use agents for:**

- Simple one-step operations
- Tasks better suited for commands
- Auto-discovered capabilities (use skills instead)

## Example Agents

### Deployment Agent

```markdown
---
name: deployment-agent
description: Handles deployment operations with safety checks
allowed-tools: [Bash, Read]
model: sonnet
---

# Deployment Agent

Handles deployment with comprehensive validation.

## Responsibilities

1. Pre-deployment validation
2. Environment configuration
3. Deployment execution
4. Post-deployment verification
5. Rollback if needed

## Deployment Steps

### 1. Validate

- All tests passing
- No uncommitted changes
- Target environment correct
- Dependencies up to date

### 2. Build

- Run build process
- Verify build artifacts
- Check build errors

### 3. Deploy

- Execute deployment script
- Monitor progress
- Check for errors

### 4. Verify

- Health checks
- Smoke tests
- Monitor logs

### 5. Report

- Deployment summary
- Timestamp and version
- Any issues or warnings

## Rollback Procedure

If deployment fails:

1. Execute rollback script
2. Restore previous version
3. Verify rollback successful
4. Report failure details
```

### Code Analysis Agent

```markdown
---
name: code-analyzer
description: Performs deep code analysis for patterns and issues
allowed-tools: [Read, Grep, Glob]
model: opus
---

# Code Analyzer

Performs comprehensive code analysis.

## Analysis Areas

1. **Code Patterns** - Identify common patterns and anti-patterns
2. **Dependencies** - Map dependency relationships
3. **Complexity** - Measure cyclomatic complexity
4. **Duplication** - Find code duplication
5. **Best Practices** - Check adherence to standards

## Process

1. Read all source files in target directory
2. Build abstract syntax understanding
3. Apply analysis algorithms
4. Generate findings report
5. Prioritize issues by severity

## Output Format

\`\`\`

## Code Analysis Report

### Summary

- Files analyzed: N
- Issues found: N
- Severity breakdown

### Findings

#### High Priority

- [file:line] Description

#### Medium Priority

- [file:line] Description

#### Low Priority

- [file:line] Description

### Recommendations

1. Action item 1
2. Action item 2
   \`\`\`
```

### Security Scanner Agent

```markdown
---
name: security-scanner
description: Scans code for security vulnerabilities and risks
allowed-tools: [Read, Grep, Glob, Bash]
model: sonnet
---

# Security Scanner

Scans codebase for security issues.

## Security Checks

### 1. Secret Detection

- API keys in code
- Hardcoded passwords
- Private keys
- Tokens and credentials

### 2. Vulnerability Patterns

- SQL injection risks
- XSS vulnerabilities
- Command injection
- Path traversal
- Insecure deserialization

### 3. Dependency Security

- Known CVEs in dependencies
- Outdated packages
- Insecure configurations

### 4. Access Control

- Authentication bypasses
- Authorization issues
- Session management

## Process

1. Scan all source files
2. Check dependencies
3. Apply OWASP Top 10 checks
4. Generate security report
5. Prioritize by risk level

## Output Format

\`\`\`

## Security Scan Report

### Critical Issues

- [file:line] Vulnerability type - Description

### High Risk

- [file:line] Issue - Remediation

### Medium Risk

- [file:line] Issue - Recommendation

### Recommendations

1. Immediate actions
2. Follow-up items
   \`\`\`
```

### Test Runner Agent

```markdown
---
name: test-runner
description: Runs tests and analyzes test results
allowed-tools: [Bash, Read]
model: haiku
---

# Test Runner

Executes tests and reports results.

## Process

1. Run test suite
2. Capture output
3. Parse results
4. Identify failures
5. Report summary

## Execution

\`\`\`bash
bun test
\`\`\`

## Analysis

- Total tests run
- Passed/failed breakdown
- Failed test details
- Error messages
- Stack traces

## Output Format

\`\`\`

## Test Results

### Summary

- Total: N
- Passed: N
- Failed: N
- Coverage: X%

### Failed Tests

- [file:test] Error message

### Recommendations

- Fixes needed
- Areas needing more tests
  \`\`\`
```

## Invoking Agents

**Explicit invocation:**

From commands:

```markdown
---
description: Deploy to production
---

Use the deployment-agent to deploy to production environment.
```

From main agent:

```
I'll use the security-scanner agent to check for vulnerabilities.
```

**Automatic invocation:**

Claude may automatically invoke agents based on task requirements and agent descriptions.

## Agent Best Practices

### Keep Agents Specialized

One agent = one domain of expertise.

**Good:**

- `deployment-agent` - Handles deployments
- `security-scanner` - Security analysis
- `test-runner` - Test execution

**Bad:**

- `helper-agent` - Too vague
- `code-agent` - Too broad

### Use Appropriate Models

```yaml
model: haiku    # Fast, simple tasks (test runner)
model: sonnet   # Balanced (deployment)
model: opus     # Complex reasoning (code analysis)
```

### Define Clear Responsibilities

List specific tasks the agent handles:

```markdown
## Responsibilities

1. Validate input parameters
2. Execute deployment steps
3. Verify deployment success
4. Handle rollback if needed
5. Generate deployment report
```

### Specify Output Format

Help Claude understand expected results:

```markdown
## Output Format

Return JSON:
\`\`\`json
{
"status": "success|failure",
"details": "...",
"recommendations": ["...", "..."]
}
\`\`\`
```

### Restrict Tools Appropriately

```yaml
# Read-only analysis
allowed-tools: [Read, Grep, Glob]

# Test execution
allowed-tools: [Bash, Read]

# Deployment
allowed-tools: [Bash, Read, Write]
```

## Agents vs Skills vs Commands

**Use Agents when:**

- Need specialized subagent
- Complex multi-step process
- Task benefits from focused context
- Want explicit delegation

**Use Skills when:**

- Claude should auto-discover
- Capability used frequently
- Want seamless integration

**Use Commands when:**

- User explicitly invokes
- Simple prompt template
- Direct user control

## Testing Agents

1. **Install plugin** with agents
2. **Invoke explicitly** - Reference agent in prompt or command
3. **Verify execution** - Agent activates and completes task
4. **Check output** - Results match expected format
5. **Test tool restrictions** - Verify allowed-tools work

## Troubleshooting

**Agent not found:**

- Check `agents/` directory exists
- Verify `.md` file extension
- Check frontmatter YAML syntax
- Restart Claude Code

**Agent fails during execution:**

- Run `claude --debug`
- Check allowed-tools includes needed tools
- Verify agent instructions are clear
- Test tool operations independently

**Wrong agent invoked:**

- Make description more specific
- Clarify agent responsibilities
- Ensure agent names are distinct
