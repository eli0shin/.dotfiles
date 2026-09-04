#!/usr/bin/env bash
set -euo pipefail

extensions_dir="${DOTFILES_DIR:-$HOME/.dotfiles}/home/.pi/agent/extensions"
npm_command="$(command -v npm || true)"

if [[ -z "$npm_command" ]]; then
    pi_node_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin"
    npm_command="$pi_node_dir/npm"
    export PATH="$pi_node_dir:$PATH"
fi

if [[ ! -x "$npm_command" ]]; then
    echo "npm is required to install Pi extension dependencies" >&2
    exit 1
fi

"$npm_command" ci --ignore-scripts --prefix "$extensions_dir"
