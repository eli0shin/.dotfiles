# Matt Pocock skills update audit

## Scope and evidence

Compared installed `~/.agents/skills` (resolves to this repo's `home/.agents/skills`) and `home/.agents/.skill-lock.json` with Matt's repository at [`4588b32`](https://github.com/mattpocock/skills/tree/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d), inspected on 2026-10-05.

Latest release: **v1.3.1**, released 2026-10-04. The larger update is **v1.3.0**, also released 2026-10-04 (tagged 2026-09-29). Sources: [v1.3.1](https://github.com/mattpocock/skills/releases/tag/v1.3.1), [v1.3.0](https://github.com/mattpocock/skills/releases/tag/v1.3.0), [pinned changelog](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/CHANGELOG.md).

All **20 Matt-source lockfile entries** have folder hashes equal to the corresponding Git tree objects in **v1.2.3**. The lockfile records installation/update on 2026-08-06. This identifies the upstream baseline, not the current local file contents: several skills were subsequently customized.

There is also a locally rewritten `code-review`, not recorded in the lockfile. Its upstream namesake has changes, but it is not safe to treat this as an ordinary package update.

## Installed skills with upstream updates

For the 20 tracked skills: **18 have upstream updates, one is unchanged, and one was removed**. Upstream updates here mean the complete skill directory changed, not necessarily a new feature. Most diff volume is prose punctuation cleanup.

Source for all directory-change classifications: [`v1.2.3...v1.3.1` comparison](https://github.com/mattpocock/skills/compare/v1.2.3...v1.3.1), checked locally with Git tree comparisons and file diffs. Main and v1.3.1 have identical installed-skill directory contents at the audited commit.

| Installed skill | What changed upstream |
| --- | --- |
| `domain-modeling` | `CONTEXT.md` becomes `GLOSSARY.md`; `CONTEXT-MAP.md` becomes `GLOSSARY-MAP.md`; reference file becomes `GLOSSARY-FORMAT.md`; broader description triggers on terminology and glossary/ADR edits. |
| `setup-matt-pocock-skills` | Setup and domain-consumer template adopt glossary filenames; prose cleanup. |
| `tdd` | Reads `GLOSSARY.md`; explicitly loads `codebase-design`; prose cleanup. |
| `diagnosing-bugs` | Reads `GLOSSARY.md`; removes automatic architecture/post-mortem handoff, leaving cleanup; prose cleanup. Secret-redaction rules were already in your baseline. |
| `triage` | Reads glossary filenames; explicit model-invoked skill calls; tells human to run setup instead of attempting to invoke it; prose cleanup. |
| `improve-codebase-architecture` | Adopts glossary filenames; explicit shared-skill calls; prose cleanup. |
| `codebase-design` | Reference documents adopt glossary filename; prose cleanup. |
| `grilling` | Horizontal rules separate consecutive questions; prose cleanup. Round-based questioning already exists locally. |
| `grill-me` | Explicitly calls `grilling` through the Skill tool. |
| `grill-with-docs` | Explicitly calls both `grilling` and `domain-modeling` through the Skill tool. |
| `handoff` | Suggested-skills section explicitly names Skill tool calls. |
| `to-spec` | Tells human to run setup when needed; fixes description YAML quoting; prose cleanup. |
| `to-tickets` | Tells human to run setup when needed; prose cleanup. Vertical slices and expand-contract refactors already exist in the baseline. |
| `wayfinder` | Explicit model-invoked skill calls; tells human to run setup when needed; prose cleanup. |
| `prototype` | Prose/punctuation cleanup; no new workflow relative to your baseline. |
| `research` | Prose/punctuation cleanup; no new workflow relative to your baseline. |
| `teach` | Prose/punctuation cleanup; no new workflow relative to your baseline. |
| `writing-for-agents` | Prose/punctuation cleanup; no new workflow relative to your baseline. |

**Unchanged:** `implement` is identical upstream to v1.2.3.

**Removed:** `resolving-merge-conflicts` was removed in v1.3.0 without a replacement. You can keep your local copy if useful; this is not an instruction to delete it.

**Custom replacement:** Upstream `code-review` has prose/frontmatter/setup-invocation changes. Your local skill is a substantially different evidence-gated review policy, so retain it rather than overwrite it.

## Update compatibility risks

1. **Glossary migration:** `home/.agents/AGENTS.md` still says to always read `CONTEXT.md`, as do other local instructions and skills. Upstream now expects `GLOSSARY.md` and `GLOSSARY-MAP.md`. Decide whether to migrate project docs and all consumers together, or adapt the incoming changes to preserve your current naming. Do not silently split vocabulary between two files. No `CONTEXT.md` files were found in this dotfiles checkout; other projects were not audited.
2. **Harness invocation:** Several updates now literally say `Call the Skill tool`. This session exposes file-reading tools, not a Skill tool. Adapt those instructions to the actual skill-loading mechanism in your harness rather than copying nonexistent tool calls.
3. **Local customizations:** Preserve OpenCode slash/autoinvoke frontmatter. Body/reference customizations exist in `improve-codebase-architecture`, `codebase-design`, `grilling`, `wayfinder`, `writing-for-agents`, and `research`; these generally replace background-subagent instructions with direct work. In particular, your Wayfinder resolves research in separate sessions instead of launching research subagents while charting. `code-review` is a separate local rewrite.

Evidence for local customization: installed files compared with their v1.2.3 equivalents, ignoring frontmatter to distinguish body changes from harness metadata.

## Missing promoted skills and recommendations

There are **seven promoted upstream skills not installed locally**. Three were newly promoted in v1.3.0; four were available in earlier releases. Source: [pinned README](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/README.md) and changelog.

| Skill | Release status | Recommendation for this setup |
| --- | --- | --- |
| [`retro`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/retro/SKILL.md) | Newly promoted in v1.3.0 | **Install.** Review sessions for improvements to navigation, deterministic guardrails, reviewer rules, information access and tool economy. Good fit for a heavily customized agent environment. It proposes improvements rather than automatically applying them. |
| [`to-questionnaire`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/productivity/to-questionnaire/SKILL.md) | Previously available | **Install.** Turn unknowns held by a colleague/domain expert into an async questionnaire. Complements your meeting-search, action-items and work workflows. Interviews you about who receives it and what you need back, not facts you cannot know. |
| [`wizard`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/wizard/SKILL.md) | Previously available | **Consider installing.** Generates interactive Bash guides for genuinely human-only setup, credentials, dashboard steps and migrations. Complements `dot` without replacing operations the agent or existing scripts can already perform. |
| [`pr`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/pr/SKILL.md) | Newly promoted in v1.3.0 | **Borrow ideas rather than install alongside `creating-prs`.** Visual summary, before/after evidence and merge risk are useful. Its fixed template overlaps with your repo-native PR-template discipline and `show-me`. |
| [`implement-spec`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/implement-spec/SKILL.md) | Newly promoted in v1.3.0 | **Skip for now.** Task-graph implementation through concurrent worktrees, merger subagents and one integration branch overlaps strongly with your `orchestrator`/`ticket-worker`/Tickets system. It would need adaptation to `repos`, review tools and PR Watch boundaries. |
| [`wait-what`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/productivity/wait-what/SKILL.md) | Previously available | **Skip unless you prefer its phrasing.** Plain-English re-pitch overlaps with your `bro` command; adds glossary vocabulary and missing context. |
| [`ask-matt`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/ask-matt/SKILL.md) | Previously available | **Optional; adapt before installing.** Router helps remember the suite, but upstream routes assume Matt's set rather than your custom alternatives. v1.3.1 corrects its stale debugging/post-mortem route. |

These fit recommendations are judgments based on your installed skill files, not upstream claims about your workflow.

## Experimental skills

[`chief-of-staff`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/in-progress/chief-of-staff/SKILL.md) was added on main on **2026-10-05**, after v1.3.1. It is not part of that release: a beta strategic coordinator for a long-running goal, with tactical work delegated to subagents and recurring schedules where supported. Interesting to watch, but not a drop-in replacement for your event-driven orchestrator; your setup's subagent adaptations suggest caution.

Other uninstalled beta/misc skills exist (writing skills, TypeScript boundary setup, Claude-specific handoff/guardrails, exercise scaffolding and test-data migration). They are more specialized and are not first recommendations for this setup.

## Proposed next step

Selectively merge meaningful upstream changes while preserving your local adaptations. Resolve the glossary filename policy before updating domain-document consumers. Install `retro` and `to-questionnaire`; optionally add `wizard`. No skills, lockfiles or global instructions were changed during the initial audit.

## Applied changes

On the user's subsequent request, merged the 18 installed-skill updates from v1.3.1 while preserving local body edits and OpenCode metadata. Removed `resolving-merge-conflicts` and its lockfile entry. Added `retro` and `pr`, both user-invoked; `pr` explicitly has `disable-model-invocation: true` and OpenCode autoinvocation disabled. Updated the lockfile's upstream folder hashes and timestamps. Left custom `code-review`, unchanged `implement`, and unrelated skills untouched.

Adapted upstream Skill-tool instructions to explicit file reads for this setup. Adopted the new glossary convention with compatibility for configured or existing legacy `CONTEXT.md`/`CONTEXT-MAP.md`, without renaming any project domain documents or changing global instructions.
