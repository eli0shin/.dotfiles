---@type rest.Opts
vim.g.rest_nvim = {
  request = {
    skip_ssl_verification = true,
  },
}

return {
  'rest-nvim/rest.nvim',
  lazy = true,
  event = 'VeryLazy',
}
