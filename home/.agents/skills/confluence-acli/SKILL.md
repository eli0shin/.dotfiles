---
name: confluence-acli
description: Reads Confluence Cloud pages through Atlassian CLI (`acli`) and extracts useful page text/metadata. Use when the user asks to read, inspect, summarize, or use a Confluence/wiki page via acli, especially URLs from `*.atlassian.net/wiki/spaces/.../pages/<pageId>/...`.
---

# Confluence via acli

## Quick start

1. Extract the numeric page ID from the URL path segment after `/pages/`.
   - Example: `https://example.atlassian.net/wiki/spaces/ABC/pages/123456789/Page+Title` → `123456789`
2. Confirm `acli` is installed and inspect the page command if needed:
   ```bash
   which acli
   acli confluence page view --help
   ```
3. Read the page as JSON with rendered body HTML:
   ```bash
   acli confluence page view --id 123456789 --body-format view --json
   ```
4. If output is truncated, use the temp log path reported by the bash tool, or redirect to a file yourself.
5. Extract readable text from `body.view.value`:
   ```bash
   python3 - <<'PY'
   import json, re, html, sys
   path = sys.argv[1]
   data = json.load(open(path))
   body = data.get('body', {}).get('view', {}).get('value', '')
   body = re.sub(r'<(script|style).*?</\\1>', '', body, flags=re.S|re.I)
   body = re.sub(r'</(p|div|h[1-6]|li|tr|table)>', '\n', body, flags=re.I)
   body = re.sub(r'<br\\s*/?>', '\n', body, flags=re.I)
   body = re.sub(r'<[^>]+>', '', body)
   lines = [re.sub(r'\\s+', ' ', line).strip() for line in html.unescape(body).splitlines()]
   print('\n'.join(line for line in lines if line))
   PY /path/to/acli-output.json
   ```

## Workflow

- Start with the user's exact Confluence URL; do not ask for the page ID if it is present in the URL.
- Use `--body-format view` for human-readable content. Use `--body-format storage` only when markup/macros matter.
- Use `--json` so metadata and body are machine-readable.
- Preserve useful metadata in your notes: `id`, `title`, `_links.webui`, `version.number`, `version.createdAt`, `authorId` if relevant.
- If the user asks to "read" the page, provide a short confirmation and high-signal summary unless they explicitly ask for full text.
- If the page is needed for implementation, keep the extracted text available in the conversation and cite the relevant sections when making code changes.

## Authentication and errors

- If `acli` reports auth errors, run/help the user run:
  ```bash
  acli confluence auth login
  ```
  or inspect:
  ```bash
  acli auth --help
  acli confluence auth --help
  ```
- If access is denied, report that the current Atlassian account lacks permission; do not try to bypass permissions.
- If body content is missing, retry with another body format:
  ```bash
  acli confluence page view --id 123456789 --body-format storage --json
  acli confluence page view --id 123456789 --body-format atlas_doc_format --json
  ```

## Useful commands

```bash
# Basic metadata/text JSON
acli confluence page view --id PAGE_ID --body-format view --json

# Include labels/version details when relevant
acli confluence page view --id PAGE_ID --body-format view --include-labels --include-version --json

# Save large output explicitly
acli confluence page view --id PAGE_ID --body-format view --json > /tmp/confluence-page.json
```
