require 'nvim-config'
require 'motions'
require 'autocommands'
require 'lazy-setup'

vim.g.github_enterprise_urls = { 'https://github.paypal.com' }

--  To check the current status of your plugins, run
--    :Lazy
require('lazy').setup({
  require 'plugins.tpope',
  require 'plugins.no-neck-pain',
  require 'plugins.comment',
  require 'plugins.gitsigns',
  require 'plugins.which-key',
  require 'plugins.lualine',
  require 'plugins.telescope',
  require 'plugins.lsp',
  require 'plugins.conform',
  require 'plugins.todo-comments',
  require 'plugins.mini',
  require 'plugins.treesitter',
  require 'plugins.zen-mode',
  require 'plugins.octo',
  require 'plugins.leap',
  require 'plugins.jester',
  require 'plugins.cspell',
  require 'plugins.diffview',
  require 'plugins.tmux',
  require 'plugins.logsitter',
  require 'plugins.oil',
  require 'plugins.arrow',
  -- require 'plugins.rest',
  require 'plugins.render-markdown',
  require 'plugins.grug-far',
  require 'plugins.arctic',
  require 'plugins.mcp-hub',
  require 'plugins.copilot',
  require 'plugins.blink-compat-init',
  require 'plugins.blink-cmp',
  require 'plugins.claude-code',
  require 'plugins.indent_line',
  require 'plugins.lint',
  require 'plugins.trouble',
  require 'plugins.noice',
  require 'plugins.numb',
  require 'plugins.fff',
}, {
  ui = {
    icons = {},
  },
  performance = {
    rtp = {
      -- disable some rtp plugins
      disabled_plugins = {
        'gzip',
        'matchit',
        'matchparen',
        'netrwPlugin',
        'tarPlugin',
        'tohtml',
        'tutor',
        'zipPlugin',
        'spellfile_plugin',
        'rplugin',
        'shada',
      },
    },
  },
  -- Add profiling capabilities
  profiling = {
    -- Enable profiling of loading times
    loader = false,
    -- Enable detailed profiling of require() calls
    require = false,
  },
})
