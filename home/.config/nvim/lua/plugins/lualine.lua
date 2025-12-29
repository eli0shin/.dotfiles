-- Minimal lualine.nvim config
return {
  'nvim-lualine/lualine.nvim',
  event = 'VeryLazy',
  dependencies = { 'nvim-tree/nvim-web-devicons', opt = true },
  opts = {
    options = {
      theme = 'auto',
      icons_enabled = true,
      section_separators = '',
      component_separators = '',
      disabled_filetypes = { 'NvimTree', 'oil', 'Trouble', 'dashboard', 'alpha', 'avante', 'codecompanion' },
      always_divide_middle = false,
      globalstatus = true,
    },
    sections = {
      lualine_a = { 'mode' },
      lualine_b = { 'branch' },
      lualine_c = { { 'filename', path = 1 } },
      lualine_x = { 'filetype' },
      lualine_y = { 'diff' },
      lualine_z = { 'location' },
    },
    inactive_sections = {
      lualine_a = {},
      lualine_b = {},
      lualine_c = { { 'filename', path = 1 } },
      lualine_x = {},
      lualine_y = {},
      lualine_z = {},
    },
    tabline = {},
    extensions = {},
  },
}
