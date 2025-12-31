# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal dotfiles managed with GNU Stow. The `dot` CLI handles all operations.

## Common Commands

```bash
dot init              # Full setup: brew, stow, git hooks
dot stow              # Create symlinks to ~
dot unstow            # Remove symlinks
dot update            # Pull repo and re-stow
dot update --packages # Also update Homebrew packages
dot doctor            # Check installation health
dot merge             # Merge config files (*.base.json -> *.json)

# Package management
dot package add <pkg>                      # Add brew package
dot package add <name> "<install-script>"  # Add bash package with custom installer
dot package add <pkg> --personal           # Add to personal Brewfile
dot package remove <pkg>
dot package list
```

## Architecture

### Directory Structure

- `dot` - Main CLI script (bash)
- `home/` - Configs that get symlinked to `~` via stow
- `packages/` - Brewfile and bash-packages.json
- `scripts/` - Helper scripts (merge-config.sh, git-hook-merge.sh)
- `.dotprofile` - Machine profile ("work" or "personal"), gitignored

### Config Merging System

The repo uses a layered config system for JSON files that need machine-specific customization:

```
*.base.json  ->  *.json (generated, gitignored)
```

Merge order: `base` -> `{profile}` -> `local`

Example for `settings.base.json`:
1. `settings.base.json` (committed)
2. `settings.work.json` or `settings.personal.json` (committed, optional)
3. `settings.local.json` (gitignored, optional)

Arrays concatenate, objects deep merge. Run `dot merge` or `dot stow` to regenerate.

### Package Management

Two package types:
- **Brew packages**: Listed in `packages/Brewfile` and `Brewfile.personal`
- **Bash packages**: Listed in `packages/bash-packages.json` with command name and install script

### Git Hooks

Auto-installed hooks run `dot merge` on checkout/merge to regenerate config files.

## Key Files

- `home/.claude/settings.base.json` - Claude Code settings (base layer)
- `home/.config/opencode/config.base.json` - OpenCode settings (base layer)
- `packages/Brewfile` - Core brew packages
- `packages/Brewfile.personal` - Personal-only packages
