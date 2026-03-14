return {
  'folke/snacks.nvim',
  lazy = false,
  priority = 900,
  ---@type snacks.Config
  opts = {
    image = {},
  },
  keys = {
    { '<leader>si', function() Snacks.image.hover() end, desc = '[S]nacks [I]mage hover' },
  },
}
