---
name: artifact
description: Use when a user asks to publish or make an artifact.
---

# Artifact

1. Resolve “that” to a file or directory. If it does not exist on disk, materialize it in a temporary directory first. For a browser artifact, put `index.html` at the directory root.
2. Publish it:
   ```bash
   artifact publish <path> --name <name>
   ```
   Always specify `--name`. Derive a short, relevant name from the artifact.
3. Return the URL printed by the command. Publication is complete only when the command succeeds and the user has the URL.
