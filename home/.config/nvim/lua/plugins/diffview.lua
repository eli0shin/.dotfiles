return {
  'sindrets/diffview.nvim',
  lazy = true,
  keys = {
    { '<leader>d', group = '[D]iff' },
    { '<leader>dv', group = '[V]iew' },
    { '<leader>dvc', '<cmd>DiffviewClose<cr>', desc = '[C]lose' },
    { '<leader>dvo', '<cmd>DiffviewOpen<cr>', desc = '[O]pen' },
    { '<leader>dvi', ':DiffviewOpen ', desc = '[I]nsert Target Git Object' },
  },
  opts = {
    keymaps = {
      view = {
        -- Disable the default <leader>e keymap to avoid conflict with LSP diagnostics
        { "n", "<leader>e", false },
      },
    },
  },
}
