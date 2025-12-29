# Eli's Neovim Configuration

A powerful and feature-rich Neovim setup optimized for modern development workflows.

## Features

- **Lazy Plugin Management**: Using lazy.nvim for efficient plugin loading
- **Modern UI**: Minimal and clean interface with Arctic theme
- **LSP Integration**: Full Language Server Protocol support with intelligent code completion
- **Git Integration**: Seamless git workflow with Fugitive, Gitsigns, Diffview, and Octo
- **AI Assistance**: CodeCompanion, Copilot, and Aider integration for AI-powered development
- **Testing Tools**: Jester for JavaScript/TypeScript testing
- **Debugging**: DAP integration for interactive debugging
- **File Navigation**: Oil.nvim and Telescope for intuitive file management
- **Quality of Life**: No-neck-pain, zen-mode, and more ergonomic enhancements

## Prerequisites

- Neovim >= 0.11.0
- Git
- [Optional] Nerd Font for icons
- Node.js (for LSP servers)
- [Optional] Ripgrep for better Telescope search

## Installation

```bash
# Backup your existing config
mv ~/.config/nvim ~/.config/nvim.backup

# Fork this repo so that you can treak it to your liking

# Clone this repository
git clone https://github.com/yourusername/nvim-config.git ~/.config/nvim

# Start Neovim (plugins will install automatically)
nvim
```

## Structure

```
.
├── init.lua                 # Entry point and plugin initialization
└── lua/
    ├── plugins/             # Individual plugin configurations
    ├── utils/               # Helper utilities
    ├── autocommands.lua     # Custom autocommands
    ├── motions.lua          # Custom motions and keymaps
    ├── nvim-config.lua      # Core Neovim settings
    ├── health.lua           # Health checks
    └── lazy-setup.lua       # Lazy.nvim configuration
```

## Key Plugins

- **LSP Configuration**: Native LSP with enhanced capabilities
- **Telescope**: Fuzzy finder for files, buffers, and more
- **Treesitter**: Advanced syntax highlighting
- **Copilot & CodeCompanion**: AI assistants for coding
- **DAP**: Debug Adapter Protocol for interactive debugging
- **Oil.nvim**: File explorer in a buffer
- **Conform.nvim**: Code formatting
- **Which-key**: Key binding hints
- **Arrow.nvim**: Quick navigation within buffers

## Customization

To customize this configuration:

1. Modify existing plugin files in `lua/plugins/`
2. Add new plugins by creating new files in the same directory and importing them in `init.lua`
3. Adjust core settings in `lua/nvim-config.lua`

## Special Features

- **MCP-Hub**: Integration with Model Context Protocol for AI tools
- **Blink Integration**: Enhanced AI coding assistance
- **CSpell**: Spell checking for code and documentation
- **Rest.nvim**: HTTP client for API testing
- **Diffview**: Enhanced git diff viewer
- **Tmux Integration**: Seamless tmux navigation

## License

MIT

## Acknowledgements

Inspired by various Neovim configurations in the community, with a focus on productivity and developer experience.


