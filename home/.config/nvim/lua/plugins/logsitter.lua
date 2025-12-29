return {
  'gaelph/logsitter.nvim',
  dependencies = { 'nvim-treesitter/nvim-treesitter' },
  lazy = true,
  config = function()
    require('logsitter').setup {
      path_format = 'short',
      prefix = '[LS] ->',
      separator = '->',
    }
  end,
  keys = {
    { '<leader>t', group = '[T]urbo' },
    { '<leader>tl', '<cmd>Logsitter<cr>', desc = '[L]og' },
    { '<leader>tc', '<cmd>LogsitterClearBuf<cr>', desc = '[C]lear File' },
  },
}
