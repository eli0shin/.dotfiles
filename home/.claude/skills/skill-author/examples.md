# Skill Author Examples

This file contains concrete examples of creating skills for different use cases, demonstrating best practices in action.

## Example 1: Creating a Simple Code Review Skill

### User Request

"I want to create a skill that reviews TypeScript code for common mistakes"

### Step-by-Step Process

**1. Choose skill location:**
Project skill in `.claude/skills/ts-reviewer/` to share with team

**2. Create directory:**

```bash
mkdir -p .claude/skills/ts-reviewer
```

**3. Write SKILL.md:**

```yaml
---
name: ts-reviewer
description: Review TypeScript code for common mistakes including type errors, unused variables, and anti-patterns. Use when user asks to review TypeScript code, check for TS errors, or improve type safety.
allowed-tools: [Read, Grep, Glob]
---

# TypeScript Code Reviewer

Review TypeScript code for common mistakes and suggest improvements.

## Review Checklist

1. **Type Safety**
   - Check for `any` types that could be more specific
   - Verify proper generic usage
   - Look for implicit any issues

2. **Code Quality**
   - Unused imports and variables
   - Dead code
   - Inconsistent naming

3. **Best Practices**
   - Prefer interfaces for object shapes
   - Use const assertions where appropriate
   - Avoid type assertions unless necessary

## Process

1. Read the specified TypeScript files
2. Apply each checklist item
3. Report findings with file:line references
4. Suggest specific fixes for each issue

## Output Format

```

File: src/utils/helper.ts:15
Issue: Using 'any' type
Recommendation: Specify concrete type or use generic constraint
Example: function process<T extends object>(data: T)

```

```

**4. Test the skill:**

- Restart Claude Code
- Ask: "Can you review this TypeScript file for issues?"
- Verify Claude uses the ts-reviewer skill automatically

## Example 2: Creating a Multi-File Documentation Generator

### User Request

"Create a skill that generates API documentation from TypeScript code"

### Step-by-Step Process

**1. Plan the structure:**

```
.claude/skills/api-doc-generator/
├── SKILL.md              # Main instructions
├── templates/
│   ├── api-template.md   # API doc template
│   └── readme-template.md # README template
└── examples.md           # This file
```

**2. Write comprehensive SKILL.md:**

```yaml
---
name: api-doc-generator
description: Generate API documentation from TypeScript code including functions, types, and interfaces. Use when user asks to create API docs, document code, or generate reference documentation.
allowed-tools: [Read, Write, Grep, Glob]
---

# API Documentation Generator

Automatically generate comprehensive API documentation from TypeScript source code.

## Workflow

1. **Discovery Phase**
   - Scan project for TypeScript files
   - Identify exported functions, types, interfaces, classes
   - Extract JSDoc comments

2. **Analysis Phase**
   - Parse function signatures
   - Extract parameter types and return types
   - Identify dependencies and relationships

3. **Generation Phase**
   - Use template from templates/api-template.md
   - Create one doc section per exported member
   - Include code examples from usage in codebase

4. **Organization Phase**
   - Group by module/file
   - Create table of contents
   - Add cross-references

## Documentation Format

See templates/api-template.md for the standard format.

Each API entry should include:
- Signature with types
- Parameter descriptions
- Return value description
- Usage example
- Related APIs

## Output Location

Generate documentation in `docs/api/` directory unless user specifies otherwise.
```

**3. Create template file (templates/api-template.md):**

````markdown
# API Reference: [Module Name]

## [Function/Type Name]

**Signature:**

```typescript
[function signature]
```
````

**Description:**
[What it does]

**Parameters:**

- `param1` (Type): Description
- `param2` (Type): Description

**Returns:**
Type - Description

**Example:**

```typescript
[usage example]
```

**See Also:**

- [Related function]
- [Related type]

```

**4. Test with multiple scenarios:**
- "Document the authentication module"
- "Generate API docs for this file"
- "Create reference documentation for all utilities"

## Example 3: Creating a Testing Skill with Scripts

### User Request
"I need a skill that runs tests and analyzes coverage gaps"

### Step-by-Step Process

**1. Plan structure with scripts:**
```

.claude/skills/test-analyzer/
├── SKILL.md
├── scripts/
│ ├── coverage-report.sh # Extract coverage data
│ └── gap-analysis.py # Analyze uncovered code
└── reference.md # Testing best practices

````

**2. Write SKILL.md with script integration:**
```yaml
---
name: test-analyzer
description: Run tests, analyze coverage, and identify testing gaps. Use when user asks to run tests, check coverage, or improve test quality.
allowed-tools: [Bash, Read, Grep, Glob]
---

# Test Analyzer

Run tests and provide detailed coverage analysis with recommendations.

## Workflow

1. **Run Tests**
   - Execute test suite with `bun test --coverage`
   - Capture results and coverage data

2. **Analyze Coverage**
   - Use scripts/coverage-report.sh to extract data
   - Identify files with <70% coverage
   - Find specific uncovered lines

3. **Gap Analysis**
   - Run scripts/gap-analysis.py on uncovered code
   - Identify critical paths without tests
   - Prioritize by code complexity

4. **Generate Report**
   - List files needing tests
   - Suggest test cases for uncovered scenarios
   - Estimate effort for full coverage

## Coverage Standards

See reference.md for team testing standards and minimum coverage requirements.

## Report Format

````

Test Results: X passed, Y failed
Overall Coverage: Z%

Files Needing Attention:

1. src/auth.ts (45% coverage)
   - Lines 23-45: Login flow untested
   - Lines 78-92: Error handling untested
     Suggested tests: [specific test cases]

2. src/utils.ts (60% coverage)
   ...

```

```

**3. Create helper scripts:**

`scripts/coverage-report.sh`:

```bash
#!/bin/bash
# Extract coverage data from Vitest report
cat coverage/coverage-summary.json | jq '.total'
```

`scripts/gap-analysis.py`:

```python
#!/usr/bin/env python3
import json
import sys

# Analyze uncovered lines for criticality
# Prioritize by code complexity, error paths, etc.
```

**4. Document in reference.md:**

```markdown
# Testing Standards

## Coverage Requirements

- Minimum 70% overall coverage
- Critical paths must have 100% coverage
- All exported functions must have tests

## Test Structure

- Arrange-Act-Assert pattern
- One assertion per test when possible
- Clear test descriptions

## Priority Testing

1. Authentication and authorization
2. Data validation and sanitization
3. Error handling
4. Business logic
5. UI interactions
```

## Example 4: Read-Only Analysis Skill

### User Request

"Create a skill that finds security issues but doesn't modify code"

### Using allowed-tools for Safety

```yaml
---
name: security-scanner
description: Scan code for security vulnerabilities including SQL injection, XSS, and hardcoded secrets. Use when user requests security audit, vulnerability scan, or security review.
allowed-tools: [Read, Grep, Glob]  # Read-only, no modifications
---

# Security Scanner

Scan codebase for common security vulnerabilities without making any changes.

## Security Checks

1. **Input Validation**
   - Grep for SQL queries with string concatenation
   - Check for unescaped user input in HTML
   - Find missing validation on API endpoints

2. **Secret Detection**
   - Search for hardcoded passwords, API keys
   - Check for exposed credentials in config files
   - Identify potential token leaks

3. **Authentication Issues**
   - Missing authorization checks
   - Weak password requirements
   - Session handling problems

## Reporting

For each finding:
- File and line number
- Vulnerability type and severity
- Explanation of risk
- Recommended fix

**Note:** This skill only reads and reports. It never modifies code automatically to ensure security changes are reviewed by humans.
```

**Why this design:**

- `allowed-tools: [Read, Grep, Glob]` prevents accidental modifications
- Security-sensitive operations should be read-only
- Forces human review of all security changes

## Example 5: Progressive Disclosure Pattern

### Large Reference Material

**SKILL.md** (keeps it concise):

```yaml
---
name: aws-helper
description: Help with AWS infrastructure tasks including Lambda, S3, DynamoDB, and CloudFormation. Use when user asks about AWS services, deployment, or cloud infrastructure.
---

# AWS Helper

Assist with AWS infrastructure and deployment tasks.

## Capabilities

- Lambda function deployment and configuration
- S3 bucket operations and policies
- DynamoDB table design and queries
- CloudFormation template creation

## Service-Specific Guidance

For detailed information on each service, see reference.md:
- Lambda best practices and deployment
- S3 security and access patterns
- DynamoDB data modeling
- CloudFormation template patterns

## Common Tasks

1. **Deploy Lambda Function**
   - Package function code
   - Create/update function via AWS CLI
   - Configure triggers and permissions

2. **Create S3 Bucket with Policy**
   - Use templates/s3-policy.json
   - Configure CORS if needed
   - Set lifecycle rules

See reference.md for complete details on each task.
```

**reference.md** (extensive details):

```markdown
# AWS Reference Documentation

## Lambda Functions

### Best Practices

[Detailed Lambda best practices...]

### Deployment Process

[Step-by-step deployment guide...]

### Common Issues

[Troubleshooting guide...]

## S3 Buckets

### Security Configuration

[Detailed S3 security...]

### Access Patterns

[S3 access pattern guide...]

[... extensive documentation continues ...]
```

**Why this pattern:**

- SKILL.md remains scannable and quick to load
- Claude reads reference.md only when needed
- Keeps skill focused while providing depth

## Key Takeaways

1. **Specific descriptions win** - Include trigger keywords
2. **One capability per skill** - Don't create catch-all skills
3. **Examples are critical** - Show concrete usage
4. **Test auto-discovery** - Verify Claude finds your skill
5. **Use supporting files** - Keep SKILL.md focused
6. **Restrict tools when appropriate** - Use allowed-tools for safety
7. **Document for your team** - Include version history and references

## Anti-Patterns to Avoid

### ❌ Too Broad

```yaml
name: code-helper
description: Helps with code
```

**Problem:** Vague, no trigger keywords, unclear purpose

### ✅ Better

```yaml
name: ts-refactor-assistant
description: Refactor TypeScript code to improve readability and maintainability. Use when user asks to refactor, clean up, or improve TS code structure.
```

### ❌ Everything in One File

Creating a giant SKILL.md with all details inline.

### ✅ Better

Use progressive disclosure: essential instructions in SKILL.md, details in reference.md, examples in examples.md.

### ❌ No Test Plan

Creating skill and assuming it works.

### ✅ Better

Test with multiple prompts that match description, verify auto-discovery, confirm tool restrictions work.
