#!/bin/bash

# Read JSON input from stdin
input=$(cat)

# Extract values from JSON
project_dir=$(echo "$input" | jq -r '.workspace.project_dir')
model=$(echo "$input" | jq -r '.model.display_name')
transcript_path=$(echo "$input" | jq -r '.transcript_path')

# Get formatted context info from context_size.sh
context_info=$(~/.claude/scripts/context_size.sh "$transcript_path" 2>/dev/null)

# Get running LSP servers
lsp_info=$(cli-lsp-client statusline 2>/dev/null)

# Get git changes from project directory
git_additions=0
git_deletions=0
if [ -d "$project_dir/.git" ]; then
  while read -r added deleted _; do
    [[ "$added" == "-" ]] && continue  # skip binary files
    git_additions=$((git_additions + added))
    git_deletions=$((git_deletions + deleted))
  done < <(git -C "$project_dir" diff HEAD --numstat 2>/dev/null)
fi

# Format git info with colors
git_info=""
if [ "$git_additions" -gt 0 ] || [ "$git_deletions" -gt 0 ]; then
  git_info=" \033[32m+${git_additions}\033[38;2;163;163;163m \033[31m-${git_deletions}\033[38;2;163;163;163m"
fi

# Build the status line with tokens and model
status_text="$model $context_info$git_info $lsp_info"

# Create the colored status text with color #A3A3A3 (RGB: 163,163,163)
colored_status="\033[38;2;163;163;163m$status_text\033[0m"

printf "%b" "$colored_status"
