return {
  'pwntester/octo.nvim',
  -- commit = 'f09ff9413652e3c06a6817ba6284591c00121fe0',
  -- pin = true,
  lazy = true,
  requires = {
    'nvim-lua/plenary.nvim',
    'nvim-telescope/telescope.nvim',
    'nvim-tree/nvim-web-devicons',
  },
  config = function()
    require('octo').setup { enable_builtin = true, suppress_missing_scope = {
      projects_v2 = true,
    } }
  end,
  keys = {
    {
      '<leader>O',
      '<cmd>Octo<cr>',
      { desc = 'Octo' },
    },
  },
}
