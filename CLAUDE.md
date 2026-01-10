# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal dotfiles managed with GNU Stow. The `dot` CLI handles all operations.

## Common Commands

```bash
dot init              # Full setup: brew, packages, stow, services, system settings
dot stow              # Create symlinks to ~ (runs merge first)
dot stow --clean      # Remove dirs before stowing (use when stow conflicts)
dot unstow            # Remove symlinks
dot update            # Pull repo and re-stow
dot update --packages # Also update Homebrew packages
dot doctor            # Check installation health
dot merge             # Merge config files (*.base.json -> *.json)
dot edit              # Open dotfiles in $EDITOR

# Package management
dot package add <pkg>                      # Add brew package (auto-detects cask)
dot package add <name> "<install-script>"  # Add bash package with custom installer
dot package add <pkg> --personal           # Add to Brewfile.personal
dot package add <pkg> --work               # Add to Brewfile.work
dot package remove <pkg>
dot package list

# System settings (reads from settings/*.json)
dot service start     # Start brew services from services.json
dot pmset apply       # Apply power management settings
dot defaults apply    # Apply macOS defaults
dot keyboard apply    # Apply keyboard remappings

# Backup/restore
dot backup            # Backup existing configs before stow
dot restore --merge   # Restore only files not in dotfiles repo
```

## Architecture

### Directory Structure

- `dot` - Main CLI script (bash)
- `home/` - Configs that get symlinked to `~` via stow
- `packages/` - Brewfile and bash-packages.json (with profile variants)
- `settings/` - System settings: services.json, pmset.json, defaults.json, keyboard.json
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

Two package types with profile variants:
- **Brew packages**: `packages/Brewfile`, `Brewfile.personal`, `Brewfile.work`
- **Bash packages**: `packages/bash-packages.json`, `bash-packages.personal.json`, `bash-packages.work.json`

### Git Hooks

Auto-installed hooks run `dot merge` on checkout/merge to regenerate config files.

## Key Files

- `home/.claude/settings.base.json` - Claude Code settings (base layer)
- `home/.config/opencode/config.base.json` - OpenCode settings (base layer)
- `settings/defaults.base.json` - macOS defaults (Finder, Dock, etc.)
- `settings/keyboard.base.json` - Key remappings (e.g., caps_lock → escape)
- `settings/services.base.json` - Brew services to auto-start
- `packages/Brewfile` - Core brew packages
