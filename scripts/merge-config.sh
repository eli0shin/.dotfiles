#!/usr/bin/env bash
set -euo pipefail

# merge-config.sh - Merge JSON config files with profile support
# Usage: merge-config.sh <base_file>
# Example: merge-config.sh /path/to/settings.base.json
#
# Merges: base -> (work|personal) -> local -> output
# Arrays are concatenated, objects are deep merged

DOTFILES_DIR="${DOTFILES_DIR:-$HOME/.dotfiles}"
PROFILE_FILE="$DOTFILES_DIR/.dotprofile"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info() { echo -e "  ${GREEN}+${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1" >&2; }
error() { echo -e "  ${RED}x${NC} $1" >&2; }

# jq deep merge function (arrays concatenate, objects merge)
JQ_DEEPMERGE='def deepmerge(a; b):
  if (a | type) == "object" and (b | type) == "object" then
    reduce (b | keys[]) as $key (a;
      if .[$key] then
        .[$key] = deepmerge(.[$key]; b[$key])
      else
        .[$key] = b[$key]
      end
    )
  elif (a | type) == "array" and (b | type) == "array" then
    a + b
  else
    b
  end;'

get_profile() {
    if [[ -f "$PROFILE_FILE" ]]; then
        cat "$PROFILE_FILE" | tr -d '[:space:]'
    else
        echo ""
    fi
}

merge_config() {
    local base_file="$1"
    local dir
    dir=$(dirname "$base_file")
    local filename
    filename=$(basename "$base_file")
    local name="${filename%.base.json}"
    local output_file="$dir/${name}.json"

    local profile
    profile=$(get_profile)

    # Validate base file exists
    if [[ ! -f "$base_file" ]]; then
        error "Base file not found: $base_file"
        return 1
    fi

    # Validate JSON syntax
    if ! jq empty "$base_file" 2>/dev/null; then
        error "Invalid JSON in $base_file"
        return 1
    fi

    # Build list of files to merge
    local files=("$base_file")

    # Add profile-specific file if profile is set and file exists
    if [[ -n "$profile" ]]; then
        local profile_file="$dir/${name}.${profile}.json"
        if [[ -f "$profile_file" ]]; then
            if ! jq empty "$profile_file" 2>/dev/null; then
                error "Invalid JSON in $profile_file"
                return 1
            fi
            files+=("$profile_file")
        fi
    fi

    # Add local file if exists
    local local_file="$dir/${name}.local.json"
    if [[ -f "$local_file" ]]; then
        if ! jq empty "$local_file" 2>/dev/null; then
            error "Invalid JSON in $local_file"
            return 1
        fi
        files+=("$local_file")
    fi

    # Perform merge
    local result
    result=$(cat "${files[0]}")

    for ((i=1; i<${#files[@]}; i++)); do
        result=$(jq -n "$JQ_DEEPMERGE deepmerge(\$a; \$b)" \
            --argjson a "$result" \
            --argjson b "$(cat "${files[$i]}")")
    done

    # Write output
    echo "$result" | jq '.' > "$output_file"
    info "$output_file"
}

# Main
if [[ $# -lt 1 ]]; then
    echo "Usage: merge-config.sh <base_file>" >&2
    exit 1
fi

merge_config "$1"
