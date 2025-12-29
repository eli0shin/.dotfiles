# Skills

Skills are auto-discovered capabilities that Claude activates based on context. Each skill is a directory containing SKILL.md and optional supporting files.

## Directory Structure

```
skills/
└── my-skill/
    ├── SKILL.md           # Required
    ├── reference.md       # Optional
    ├── examples.md        # Optional
    └── scripts/          # Optional
        └── helper.sh
```

## SKILL.md Format

```yaml
---
name: skill-name
description: What it does and when to use it
allowed-tools: [Read, Write, Bash]  # Optional
---

# Skill Instructions

Detailed instructions for Claude when this skill is activated.

## Process

1. Step one
2. Step two
3. Step three

For additional details, see reference.md in this skill directory.
```

## Frontmatter Fields

**name** (required):

- Lowercase letters, numbers, hyphens only
- Max 64 characters
- Must match directory name
- Example: `test-generator`, `code-reviewer`

**description** (required):

- Max 1024 characters
- Must include WHAT it does AND WHEN to use it
- Trigger keywords essential for auto-discovery

**allowed-tools** (optional):

- Array of tool names
- Restricts which tools Claude can use
- Example: `[Read, Grep, Glob]` for read-only

## Writing Effective Descriptions

**Good descriptions:**

```yaml
description: Generate unit tests using Vitest framework. Use when user asks to write tests, add test coverage, or test a function.

description: Review code for security vulnerabilities using OWASP guidelines. Use when user mentions security audit, vulnerability scan, or security review.

description: Format TypeScript code with Prettier. Use when user asks to format code or fix formatting.
```

**Bad descriptions:**

```yaml
description: Testing helper  # Too vague
description: Code stuff  # No trigger keywords
description: Does things with files  # Not specific
```

## Skill Best Practices

### Keep Skills Focused

One skill = one capability.

**Don't:**

- `file-processor` (too broad)
- `code-helper` (too vague)

**Do:**

- `csv-parser`
- `json-validator`
- `xml-transformer`

### Use Specific Trigger Keywords

Include terms users will naturally use:

```yaml
# For test generation skill
description: Generate unit tests using Vitest. Use when user asks to "write tests", "add tests", "test coverage", "test this function", or "create test cases".
```

### Progressive Disclosure

Put essentials in SKILL.md, details in separate files:

```markdown
# SKILL.md

Main workflow and instructions...

For API details, see reference.md
For examples, see examples.md
Run validation: `bash scripts/validate.sh`
```

Claude loads supporting files only when needed.

### Tool Restrictions

For read-only skills:

```yaml
allowed-tools: [Read, Grep, Glob]
```

For analysis skills:

```yaml
allowed-tools: [Read, Grep, Glob, WebFetch, WebSearch]
```

For implementation skills:

```yaml
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
```

## Supporting Files

### reference.md

Detailed documentation Claude can reference:

```markdown
# API Reference

## Function Signatures

...

## Configuration Options

...
```

### examples.md

Usage patterns and examples:

```markdown
# Examples

## Example 1: Basic Usage

Input: ...
Output: ...

## Example 2: Edge Case

...
```

### scripts/

Helper scripts the skill uses:

```bash
#!/bin/bash
# scripts/validate.sh

# Validation logic
...
```

Make scripts executable: `chmod +x scripts/*.sh`

## Testing Skills

1. **Create the skill** in plugin or project
2. **Restart Claude Code** (skills load on startup)
3. **Test auto-discovery** - Ask questions matching description WITHOUT mentioning skill name
4. **Verify activation** - Claude should use the skill autonomously

**Test prompts:**

For a test-generator skill with description "Generate unit tests using Vitest. Use when user asks to write tests.":

Good test prompts (should activate):

- "Can you write tests for this function?"
- "I need test coverage for the auth module"
- "Add unit tests to this file"

Don't mention the skill name - test that Claude discovers it.

## Examples

### Test Generator Skill

```yaml
---
name: test-generator
description: Generate comprehensive unit tests using Vitest framework following TDD best practices. Use when user asks to write tests, add test coverage, create test cases, or test a function or module.
allowed-tools: [Read, Write, Bash, Grep, Glob]
---

# Test Generator

Generate high-quality unit tests using Vitest.

## Process

1. Read implementation code
2. Identify testable units (functions, methods, classes)
3. Generate test cases:
   - Happy path scenarios
   - Edge cases
   - Error conditions
   - Boundary values
4. Write tests using Vitest syntax
5. Run tests to verify: `bun test`
6. Report coverage

## Test Structure

See templates/test-template.ts for standard format.
See examples.md for common patterns.
```

### Code Reviewer Skill

```yaml
---
name: code-reviewer
description: Review code for quality, security, performance, and best practices. Use when user asks for code review, review changes, or check code quality.
allowed-tools: [Read, Grep, Glob, Bash]
---

# Code Reviewer

Perform thorough code reviews.

## Checklist

### Code Quality
- Readability and maintainability
- Consistent style
- Meaningful names
- Appropriate comments

### Security
- No exposed secrets
- Input validation
- SQL injection prevention
- XSS prevention

### Performance
- Efficient algorithms
- No unnecessary operations

### Testing
- Adequate test coverage
- Quality test cases

## Output Format

\`\`\`
## Code Review

### Critical Issues
- [file:line] Description and fix

### Suggestions
- [file:line] Recommendation

### Positive Feedback
- What's done well
\`\`\`
```

### Documentation Checker Skill

```yaml
---
name: doc-checker
description: Review documentation for clarity, completeness, and accuracy. Use when user asks to review docs, check documentation, or improve README files.
allowed-tools: [Read, Grep, Glob]
---

# Documentation Checker

Analyze documentation files for quality.

## Review Areas

1. **Structure** - Clear sections, logical flow, TOC
2. **Completeness** - Installation, usage, examples, API reference
3. **Clarity** - Plain language, defined terms
4. **Accuracy** - Working examples, correct commands
5. **Accessibility** - Code blocks labeled, links valid

## Process

1. Read all documentation files
2. Apply checklist from reference.md
3. Identify gaps and unclear sections
4. Suggest specific improvements with examples
5. Prioritize by impact
```

## Troubleshooting

**Skill not activating:**

- Make description more specific
- Add trigger keywords
- Validate YAML frontmatter syntax
- Check skill name matches directory name
- Restart Claude Code

**Skill fails when running:**

- Run `claude --debug` to see errors
- Verify all referenced files exist
- Check `allowed-tools` doesn't block needed tools
- Test scripts independently

**Skill activates at wrong times:**

- Refine description to be more specific
- Add explicit "Use when..." conditions
- Consider splitting into multiple focused skills
