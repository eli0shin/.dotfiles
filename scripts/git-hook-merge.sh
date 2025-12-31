#!/usr/bin/env bash
# Git hook to run config merge after checkout/merge
# Symlink this to .git/hooks/post-checkout and .git/hooks/post-merge

DOTFILES_DIR="${DOTFILES_DIR:-$HOME/.dotfiles}"

# Only run if we have the dot command
if [[ -x "$DOTFILES_DIR/dot" ]]; then
    "$DOTFILES_DIR/dot" merge 2>/dev/null || true
fi
