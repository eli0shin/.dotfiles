return {
  'aserowy/tmux.nvim',
  event = 'VeryLazy',
  config = function()
    require('tmux').setup {
      copy_sync = {
        enable = false,
      },
      resize = {
        enable_default_keybindings = false,
        resize_step_x = 10,
        resize_step_y = 10,
      },
    }
  end,
  keys = {
    {
      '<M-h>',
      function()
        require('tmux').resize_left()
      end,
      mode = { 'n', 'x', 'o', 'v' },
      desc = 'Tmux resize left',
    },
    {
      '<M-j>',
      function()
        require('tmux').resize_bottom()
      end,
      mode = { 'n', 'x', 'o', 'v' },
      desc = 'Tmux resize down',
    },
    {
      '<M-k>',
      function()
        require('tmux').resize_top()
      end,
      mode = { 'n', 'x', 'o', 'v' },
      desc = 'Tmux resize up',
    },
    {
      '<M-l>',
      function()
        require('tmux').resize_right()
      end,
      mode = { 'n', 'x', 'o', 'v' },
      desc = 'Tmux resize right',
    },
  },
}
