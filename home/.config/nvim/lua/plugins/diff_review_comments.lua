return {
  {
    dir = vim.fn.stdpath('config') .. '/plugins/diff-review-comments',
    name = 'diff-review-comments',
    lazy = false,
    keys = {
      { '<leader>dc', group = '[C]omments' },
      { '<leader>dca', desc = '[A]dd Diff Comment' },
      { '<leader>dcl', desc = '[L]ist Diff Comments' },
      { '<leader>dcr', desc = '[R]un Diff Comments Prompt' },
      { '<leader>dcx', desc = 'Clear Diff Comments' },
    },
    config = function()
      require('diff_review_comments').setup()
    end,
  },
}
