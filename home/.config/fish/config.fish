if test -d /opt/homebrew/opt/git/bin
    fish_add_path --prepend --path /opt/homebrew/opt/git/bin
end
if test -d /home/linuxbrew/.linuxbrew/bin
    fish_add_path --prepend --path /home/linuxbrew/.linuxbrew/bin
    fish_add_path --prepend --path /home/linuxbrew/.linuxbrew/sbin
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

# Match Fish syntax highlighting to the Arctic Neovim theme.
set --global fish_color_command 9CDCFE
set --global fish_color_autosuggestion 858585

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
set -gx HOMEBREW_NO_REQUIRE_TAP_TRUST 1

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

# Use vi key bindings with a block cursor in every mode.
set --global fish_key_bindings fish_vi_key_bindings
set --global fish_cursor_default block
set --global fish_cursor_insert block
set --global fish_cursor_replace_one block
set --global fish_cursor_replace block
set --global fish_cursor_external block
set --global fish_cursor_visual block

# Agnoster manages its own cursor shapes.
set --global cursor_vi_mode_normal box_steady
set --global cursor_vi_mode_insert box_steady
set --global cursor_vi_mode_visual box_steady

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
