return {
  {
    'greggh/claude-code.nvim',
    lazy = true,
    version = '*',
    dependencies = { 'nvim-lua/plenary.nvim' },
    keys = {
      { '<leader>c,', '<cmd>ClaudeCode<cr>', desc = 'Claude: Open ClaudeCode' },
    },
    config = function()
      require('claude-code').setup {
        window = {
          split_ratio = 0.4,
        },
      }
    end,
  },
}
