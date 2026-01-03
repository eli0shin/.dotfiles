fish_add_path --path "$HOME/go/bin"
fish_add_path --path /usr/local/go/bin
fish_add_path --path "$HOME/.local/bin/"
fish_add_path --path "$HOME/.bun/bin"

# Disable fish welcome message
set fish_greeting

# Add local_functions to fish function path for lazy loading
set -p fish_function_path ~/.config/fish/local_functions

alias code "/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code"
alias tmux "tmux -u"

set -g -x NVM_DIR $HOME/.nvm
set -gx NOOP_MODEL_API_KEY "*"
set -gx EDITOR "nvim"
set -gx CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR "1"

# Set turborepo remote cache token
set -gx TURBO_TOKEN c2F2ZS11cy10dXJibw==

if status is-interactive
    # setup zoxide
    zoxide init fish | source

    # setup fzf
    fzf --fish | source
end

# load_nvm >/dev/stderr

### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)
set --export --prepend PATH "/Users/eoshinsky/.rd/bin"
### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)


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
