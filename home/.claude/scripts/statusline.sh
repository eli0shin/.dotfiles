#!/bin/bash

# Read JSON input from stdin
input=$(cat)

# Extract values from JSON
project_dir=$(echo "$input" | jq -r '.workspace.project_dir')
model=$(echo "$input" | jq -r '.model.display_name')
transcript_path=$(echo "$input" | jq -r '.transcript_path')

# Color codes
gray="\033[38;2;163;163;163m"
orange="\033[38;2;193;95;60m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
reset="\033[0m"

# Get context info from context_size.sh (format: "raw_tokens display_string")
context_output=$(~/.claude/scripts/context_size.sh "$transcript_path" 2>/dev/null)
raw_tokens=$(echo "$context_output" | awk '{print $1}')
context_display=$(echo "$context_output" | cut -d' ' -f2-)

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
  git_info=" | ${green}+${git_additions}${gray} ${red}-${git_deletions}${gray}"
fi

# Determine context color based on raw token count
if [ "$raw_tokens" -gt 100000 ] 2>/dev/null; then
  context_color="$red"
elif [ "$raw_tokens" -ge 60000 ] 2>/dev/null; then
  context_color="$yellow"
else
  context_color="$gray"
fi

# Format LSP info with pipe separator
lsp_section=""
if [ -n "$lsp_info" ]; then
  lsp_section=" | ${lsp_info}"
fi

# Build the colored status line
colored_status="${orange}${model}${gray} ${context_color}${context_display}${gray}${git_info}${lsp_section}${reset}"

printf "%b" "$colored_status"
