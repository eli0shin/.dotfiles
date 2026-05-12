---
name: jira-acli
description: Reads and lightly updates Jira Cloud work items through Atlassian CLI (`acli`), including metadata, ADF descriptions, comments, attachments, and adding reference links as comments. Use when the user asks to read, inspect, summarize, triage, comment on, or update a Jira issue/work item via acli, especially keys like `FCC-114`.
---

# Jira via acli

## Quick start

```bash
# Read default fields
acli jira workitem view FCC-114 --json

# Read complete payload
acli jira workitem view FCC-114 --fields '*all' --json

# Focused read
acli jira workitem view FCC-114 --fields summary,status,assignee,reporter,priority,description,comment,attachment --json
```

## Workflow

- Start with the exact issue key the user gave; normalize to uppercase.
- Use `acli jira workitem`, not `acli jira issue`; current acli uses `workitem`.
- Prefer `--json` for machine-readable output.
- Use `--fields '*all'` when the user asks to fully read the ticket or attachments/custom fields may matter.
- If output is truncated, use the temp log path reported by the bash tool or redirect explicitly:
  ```bash
  acli jira workitem view FCC-114 --fields '*all' --json > /tmp/jira-workitem.json
  ```

## Extract readable description text

Jira descriptions are often Atlassian Document Format (ADF). Extract text from nested `content` nodes:

```bash
python3 - <<'PY'
import json, sys
p=sys.argv[1]; data=json.load(open(p)); f=data.get('fields',{})
def adf(n):
    if n is None: return ''
    if isinstance(n,list): return ''.join(adf(x) for x in n)
    if not isinstance(n,dict): return ''
    t=n.get('type'); out=[]
    if t=='heading': out.append('\n'+'#'*n.get('attrs',{}).get('level',2)+' ')
    if t=='listItem': out.append('\n- ')
    if t=='rule': out.append('\n---\n')
    if t=='hardBreak': out.append('\n')
    if 'text' in n: out.append(n['text'])
    for c in n.get('content',[]) or []: out.append(adf(c))
    if t in ('paragraph','heading'): out.append('\n')
    return ''.join(out)
print('key:', data.get('key'))
for k in ['summary','issuetype','status','priority','assignee','reporter','created','updated','duedate','labels']:
    v=f.get(k)
    if isinstance(v,dict): v=v.get('displayName') or v.get('name') or v.get('value')
    print(f'{k}: {v}')
print('\nDESCRIPTION:\n'+adf(f.get('description')))
PY /tmp/jira-workitem.json
```

## Comments and reference links

```bash
# Read comments
acli jira workitem view FCC-114 --fields summary,comment --json
acli jira workitem comment list --key FCC-114 --json

# Add a PRD/reference link comment
acli jira workitem comment create \
  --key FCC-114 \
  --body "PRD: https://example.atlassian.net/wiki/spaces/ABC/pages/123456789/Page+Title" \
  --json
```

Before changing Jira state or fields, confirm with the user. Adding a requested comment/link is low-risk, but still report exactly what was added.

## Attachments

```bash
acli jira workitem view FCC-114 --fields summary,attachment --json
```

Report filenames and URLs. Do not download attachments unless the user asks.

## Metadata to report

When summarizing a Jira work item, include: key, summary, issue type, status, priority, assignee, reporter, created/updated dates, labels, description summary, acceptance criteria, attachments, links, and subtasks if present.

## Auth and errors

- If auth fails: `acli jira auth login`
- If permission is denied, report that the current Atlassian account lacks access.
- If the key is not found, confirm project key spelling and try uppercase.
