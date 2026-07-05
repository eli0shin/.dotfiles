# Dotfiles

Personal dotfiles managed with GNU Stow.

## Quick Start

```bash
# Clone the repo
git clone git@github.com:eli0shin/.dotfiles.git ~/.dotfiles

# Run initialization
~/.dotfiles/dot init
```

## Commands

```bash
dot init              # Full setup: brew, packages, stow
dot stow              # Create symlinks
dot unstow            # Remove symlinks
dot update            # Pull repo and run init
dot doctor            # Check installation health
dot edit              # Open dotfiles in editor
dot benchmark-shell   # Benchmark Fish shell startup performance
dot benchmark-shell -r 20 -v  # 20 runs with per-run timing
dot completions       # Generate Fish shell completions for `dot`
dot package add <pkg> # Add package to Brewfile
dot package remove <pkg> # Remove package
dot package list      # List packages
dot link              # Install dot to /usr/local/bin
```

## Structure

```
~/.dotfiles/
├── dot              # CLI management script
├── home/            # Configs that symlink to ~
│   ├── .config/
│   │   ├── nvim/
│   │   ├── fish/
│   │   ├── tmux/
│   │   ├── ghostty/
│   │   ├── opencode/
│   │   ├── git/
│   │   └── omf/
│   └── .claude/
├── packages/
│   └── Brewfile
└── .gitignore
```

## Adding New Configs

1. Add config to `home/.config/<app>/` or `home/.<file>`
2. Run `dot stow` to create symlinks
3. Commit changes
