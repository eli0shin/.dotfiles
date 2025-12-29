return { -- Adds git related signs to the gutter, as well as utilities for managing changes
  'lewis6991/gitsigns.nvim',
  event = { 'BufReadPre', 'BufNewFile' },
  config = function()
    require('gitsigns').setup()
    vim.keymap.set('n', '<leader>gb', ':Gitsigns toggle_current_line_blame<cr>', { desc = 'Toggle [G]it [B]lame' })
    vim.keymap.set('n', '<leader>gc', ':Gitsigns preview_hunk<cr>', { desc = '[G]it Show [C]hange' })
    vim.keymap.set('n', '<leader>gs', ':Gitsigns stage_hunk<cr>', { desc = 'Git [S]tage Change' })
    vim.keymap.set('n', '<leader>gu', ':Gitsigns undo_stage_hunk<cr>', { desc = 'Git [U]nstage Change' })
    vim.keymap.set('n', '<leader>gS', ':Gitsigns stage_buffer<cr>', { desc = 'Git [S]tage Buffer' })
    vim.keymap.set('n', '<leader>gU', ':Gitsigns undo_stage_buffer<cr>', { desc = 'Git [U]nstage Buffer' })
  end,
  opts = {
    signs = {
      add = { text = '+' },
      change = { text = '~' },
      delete = { text = '_' },
      topdelete = { text = '‾' },
      changedelete = { text = '~' },
    },
  },
}
