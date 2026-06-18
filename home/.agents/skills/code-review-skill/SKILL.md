---
name: code-review-skill
description: |
  Provides comprehensive code review guidance for React 19, Vue 3, Angular 17+, Svelte 5, Rust, TypeScript, Java, PHP, Python, Django, Go, C#/.NET, Kotlin, Swift, NestJS, C/C++, and more.
  Helps catch bugs, improve code quality, and give constructive feedback.
  Use when: reviewing pull requests, conducting PR reviews, code review, reviewing code changes,
  establishing review standards, mentoring developers, architecture reviews, security audits,
  checking code quality, finding bugs, giving feedback on code.
---

# Code Review Skill

Transform code reviews from gatekeeping to knowledge sharing through constructive feedback, systematic analysis, and collaborative improvement.

## When to Use This Skill

- Reviewing pull requests and code changes
- Establishing code review standards for teams
- Mentoring junior developers through reviews
- Conducting architecture reviews
- Creating review checklists and guidelines
- Improving team collaboration
- Reducing code review cycle time
- Maintaining code quality standards

## Core Principles

### 1. The Review Mindset

**Goals of Code Review:**
- Catch bugs and edge cases
- Ensure code maintainability
- Share knowledge across team
- Enforce coding standards
- Improve design and architecture
- Build team culture

**Not the Goals:**
- Show off knowledge
- Nitpick formatting (use linters)
- Block progress unnecessarily
- Rewrite to your preference
- Comment on mocks because their internal implementation is simpler than or different from production code

### 2. Effective Feedback

**Good Feedback is:**
- Specific and actionable
- Educational, not judgmental
- Focused on the code, not the person
- Balanced (praise good work too)
- Prioritized (critical vs nice-to-have)

```markdown
❌ Bad: "This is wrong."
✅ Good: "This could cause a race condition when multiple users
         access simultaneously. Consider using a mutex here."

❌ Bad: "Why didn't you use X pattern?"
✅ Good: "Have you considered the Repository pattern? It would
         make this easier to test. Here's an example: [link]"

❌ Bad: "Rename this variable."
✅ Good: "[nit] Consider `userCount` instead of `uc` for
         clarity. Not blocking if you prefer to keep it."
```

### 3. Review Scope

**What to Review:**
- Logic correctness and edge cases
- Security vulnerabilities
- Performance implications
- Test coverage and quality
- Error handling
- Documentation and comments
- API design and naming
- Architectural fit

**What Not to Review Manually:**
- Code formatting (use Prettier, Black, etc.)
- Import organization
- Linting violations
- Simple typos

## Review Process

### Phase 1: Context Gathering (2-3 minutes)

Before diving into code, understand:
1. Read PR description and linked issue
2. Check PR size (>400 lines? Ask to split)
3. Review CI/CD status (tests passing?)
4. Understand the business requirement
5. Note any relevant architectural decisions


### Phase 2: High-Level Review (5-10 minutes)

1. **Architecture & Design** - Does the solution fit the problem?
   - For significant changes, consult [Architecture Review Guide](reference/architecture-review-guide.md)
   - Check: SOLID principles, coupling/cohesion, anti-patterns
2. **Performance Assessment** - Are there performance concerns?
   - For performance-critical code, consult [Performance Review Guide](reference/performance-review-guide.md)
   - Check: Algorithm complexity, N+1 queries, memory usage
3. **File Organization** - Are new files in the right places?
4. **Testing Strategy** - Are there tests covering edge cases?

### Phase 3: Line-by-Line Review (10-20 minutes)

For each file, check:
- **Logic & Correctness** - Edge cases, off-by-one, null checks, race conditions
- **Security** - Input validation, injection risks, XSS, sensitive data
- **Performance** - N+1 queries, unnecessary loops, memory leaks
- **Maintainability** - Clear names, single responsibility, comments
- **Reuse** - Before accepting new code, search for existing utilities/helpers that could replace it. Check adjacent files and shared modules for similar patterns. See [Universal Quality Guide](reference/code-quality-universal.md) for anti-patterns like parameter sprawl, leaky abstractions, nested conditionals, stringly-typed code, TOCTOU, and no-op updates.

### Mock Contract Rule

When reviewing mocks, stubs, fakes, or spies, evaluate only their **external contract**:

Do not EVER compare mock logic to production logic. Only comment when the mock’s public interface shape is wrong for the code under test: sync vs async, argument list, returned type/shape, error/rejection shape, or required side effects. Do not object that a mock uses simpler conditions than production. That is exactly what mocks are supposed to do

- Accepted inputs / call signature
- Returned output shape and type
- Async vs sync behavior
- Thrown/rejected error shape when the unit under test branches on it
- Externally observable side effects when relevant to the test

Always call out a mock when its external contract does not match the production dependency. Examples:

- Production returns `Promise<T>`, but the mock returns plain `T`
- Production can return `null`, but the mock setup makes `null` impossible in a test that depends on it
- Production returns `{ status, data }`, but the mock returns only `data`
- The mock accepts different arguments than production and would not catch a bad call site
- Production throws/rejects a specific error shape that the unit branches on, but the mock cannot produce it

Do **not** comment when the mock differs only in internal implementation. A mock is not supposed to duplicate production logic.

Before commenting on a mock, classify the issue:

- **External contract mismatch** → valid review comment
- **Internal implementation difference** → do not comment

```markdown
❌ Invalid comment:
"`isAuthenticated` mock checks `Boolean(session.auth)` but production checks token expiry. Please copy the production logic."

Why invalid: same input contract, same boolean output contract; the difference is internal logic.

✅ Valid comment:
"`getSession` is async in production, but this mock returns a session object synchronously. If the code under test forgets to await it, this test could still pass. Please return a Promise from the mock."

Why valid: async/sync behavior is part of the external contract.
```

### Phase 4: Summary & Decision (2-3 minutes)

1. Summarize key concerns
2. Highlight what you liked
3. Make clear decision:
   - ✅ Approve
   - 💬 Comment (minor suggestions)
   - 🔄 Request Changes (must address)
4. Offer to pair if complex

## Review Techniques

### Technique 1: The Checklist Method

Use checklists for consistent reviews. See [Security Review Guide](reference/security-review-guide.md) for comprehensive security checklist.

### Technique 2: The Question Approach

Instead of stating problems, ask questions:

```markdown
❌ "This will fail if the list is empty."
✅ "What happens if `items` is an empty array?"

❌ "You need error handling here."
✅ "How should this behave if the API call fails?"
```

### Technique 3: Suggest, Don't Command

Use collaborative language:

```markdown
❌ "You must change this to use async/await"
✅ "Suggestion: async/await might make this more readable. What do you think?"

❌ "Extract this into a function"
✅ "This logic appears in 3 places. Would it make sense to extract it?"
```

### Technique 4: Differentiate Severity

Use labels to indicate priority:

- 🔴 `[blocking]` - Must fix before merge
- 🟡 `[important]` - Should fix, discuss if disagree
- 🟢 `[nit]` - Nice to have, not blocking
- 💡 `[suggestion]` - Alternative approach to consider
- 📚 `[learning]` - Educational comment, no action needed
- 🎉 `[praise]` - Good work, keep it up!

**Severity levels:** 🔴 / 🟡 / 🟢 are the three severity tiers used as the standard across all guides in this skill — 🔴 blocks the merge, 🟡 should be addressed, 🟢 is optional. The remaining markers (💡 / 📚 / 🎉) are non-blocking annotations.

## Language-Specific Guides

Consult the corresponding detailed guide for the language being reviewed:

| Language/Framework | Reference File | Key Topics |
|-------------------|----------------|------------|
| **React** | [React Guide](reference/react.md) | Hooks, useEffect, React 19 Actions, RSC, Suspense, TanStack Query v5 |
| **TypeScript** | [TypeScript Guide](reference/typescript.md) | Type safety, async/await, immutability |
| **Java** | [Java Guide](reference/java.md) | Java 17/21 features, Spring Boot 3, virtual threads, Stream/Optional |
| **Go** | [Go Guide](reference/go.md) | Error handling, goroutine/channel, context, interface design |
| **Kotlin / Android** | [Kotlin Guide](reference/kotlin.md) | Coroutines, Flow, Jetpack Compose, null safety, memory leaks, architecture patterns |

## Cross-Cutting Guides

Language-agnostic patterns applicable to all code reviews:

| Topic | Reference File | Key Topics |
|-------|----------------|------------|
| **Universal Quality** | [Universal Quality Guide](reference/code-quality-universal.md) | Reuse audit, parameter sprawl, leaky abstractions, nested conditionals, stringly-typed code, TOCTOU, no-op updates, redundant state |

## Additional Resources

- [Architecture Review Guide](reference/architecture-review-guide.md) - Architecture review guide (SOLID, anti-patterns, coupling)
- [Performance Review Guide](reference/performance-review-guide.md) - Performance review guide (Web Vitals, N+1, complexity)
- [Common Bugs Checklist](reference/common-bugs-checklist.md) - Common bug checklist by language
- [Security Review Guide](reference/security-review-guide.md) - Security review guide
- [Code Review Best Practices](reference/code-review-best-practices.md) - Code review best practices
- [PR Review Template](assets/pr-review-template.md) - PR review comment template
- [Review Checklist](assets/review-checklist.md) - Quick reference checklist
