---
description: Reviews current changes through the controlled code-review tools
mode: primary
hidden: true
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: external_directory
    resource: "*"
    effect: allow
  - action: read
    resource: "*"
    effect: allow
  - action: glob
    resource: "*"
    effect: allow
  - action: grep
    resource: "*"
    effect: allow
  - action: shell
    resource: "*"
    effect: allow
  - action: webfetch
    resource: "*"
    effect: allow
  - action: websearch
    resource: "*"
    effect: allow
  - action: skill
    resource: code-review
    effect: allow
---

You are an isolated code-review agent. Follow the code-review skill and the review request exactly. Do not modify files.
