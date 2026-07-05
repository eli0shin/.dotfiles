if test -d /opt/homebrew/opt/git/bin
    fish_add_path --prepend --path /opt/homebrew/opt/git/bin
end
fish_add_path --path "$HOME/go/bin"
fish_add_path --path /usr/local/go/bin
fish_add_path --path "$HOME/.local/bin/"
fish_add_path --path "$HOME/Library/pnpm/bin"

# bun
set --export BUN_INSTALL "$HOME/.bun"
fish_add_path $BUN_INSTALL/bin

# Disable fish welcome message
set fish_greeting

# Add local_functions to fish function path for lazy loading
set -p fish_function_path ~/.config/fish/local_functions

alias tmux "tmux -u"

set -gx NVM_DIR $HOME/.nvm
set -gx NOOP_MODEL_API_KEY "*"
set -gx EDITOR nvim
set -gx CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR 1
set -gx OPENCODE_EXPERIMENTAL 1
set -gx OPENCODE_ENABLE_EXA 1
set -gx DD_TOKEN_STORAGE file

# Set turborepo remote cache token
set -gx TURBO_TOKEN c2F2ZS11cy10dXJibw==

if status is-interactive
    # setup zoxide
    if command -q zoxide
        zoxide init fish | source
    end

    # setup fzf
    if command -q fzf
        fzf --fish | source
    end
end

# Emulates vim's cursor shape behavior
# Set the normal and visual mode cursors to a block
set fish_cursor_default block
# Set the insert mode cursor to a line
set fish_cursor_insert line
# Set the replace mode cursors to an underscore
set fish_cursor_replace_one underscore
set fish_cursor_replace underscore
# Set the external cursor to a line. The external cursor appears when a command is started.
# The cursor shape takes the value of fish_cursor_default when fish_cursor_external is not specified.
set fish_cursor_external line
# The following variable can be used to configure cursor shape in
# visual mode, but due to fish_cursor_default, is redundant here
set fish_cursor_visual block

set local_vars ~/.config/fish/local_vars.fish

test -r $local_vars; and source $local_vars

# opencode
fish_add_path $HOME/.opencode/bin

# repos CLI work command
if command -q repos
    repos init --print | source
end

# sst
fish_add_path $HOME/.sst/bin
