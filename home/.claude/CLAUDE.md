## Coding instructions
IMPORTANT -- When writing typescript default to functions and types. ONLY use classes/interfaces when functions and types cannot achieve the same result.
When writing tests, do not mock deterministic functions. ONLY mock functions that interact with things like the network, filesystem, or clock.
When writing new features think about how they interact with existing features. Seek to extend existing functionality before building from scratch.
DO NOT proactively write fallbacks in code.
DO NOT leave behind code in the name of backwards compatibility unless explicitly instructed by the user.
DO NOT add security or performance requirements to a plan unless explicitly requested by the user.
ALWAYS seek to identify whether a value is defined before first verifying whether it is likely to be undefined.
ALWAYS follow TDD when writing new features.
ALWAYS seek to reproduce a bug before assuming what the fix is.
ALWAYS save a plan requested by the user to a new file, update the plan proactively when assumptions change.
When refactoring functionality, REPLACE the existing behavior with the new behavior. DO NOT add feature flags, optional parameters, or conditionals to maintain old behavior unless explicitly requested.

ALWAYS use a subagent task any time you need to search or learn about something in the codebase.
DO NOT include the current year in web search queries - it limits results and excludes relevant timeless information.

### CITATION REQUIREMENTS
- **All factual claims**: Must include source attribution (file path, URL, document)
- **Code examples**: Must reference specific documentation or codebase context
- **Version information**: Must verify against current documentation
- **Statistics/measurements**: Must cite recent, authoritative sources
- ALWAYS use a package manager to install of update a depndency (npm or bun install) NEVER write a package to package.json

## Problem Solving
- Always try the simplest fix first. Do not build abstractions, add parameters, or restructure code when a one-line change solves the problem.
- When debugging, run the failing command FIRST. Do not trace through code manually or theorize before reproducing.
- Fix problems at the right layer. If something fails only in CI, fix the CI config — not the application code. If something fails at runtime, fix the code — not the tests.

## Codebase Awareness
- Before writing any new function, search the codebase for existing helpers that do the same thing. Use them.
- Before writing tests, read 2-3 existing test files to learn the project's testing patterns. Match them exactly.
- Before proposing a fix, read the surrounding code to understand local conventions. Do not import patterns from other projects.

## Execution
- When told to run something, run it. Do not ask clarifying questions, enter plan mode, or try to predict the output.
- When an approach fails, stop and try a fundamentally different approach. Do not iterate on a broken strategy.
- Scope changes to what was asked. Do not refactor adjacent code, add documentation, or "improve" things that are working.