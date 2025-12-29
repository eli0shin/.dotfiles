return {
  'MeanderingProgrammer/render-markdown.nvim',
  event = 'BufReadPre *.md',
  dependencies = { 'nvim-treesitter/nvim-treesitter', 'echasnovski/mini.icons' },
  ---@module 'render-markdown'
  ---@type render.md.UserConfig
  opts = {},
  keys = {
    { '<leader>m', group = '[M]arkdown' },
    { '<leader>mt', '<cmd>RenderMarkdown toggle<cr>', desc = '[T]oggle' },
  },
}
