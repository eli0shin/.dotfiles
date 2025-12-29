-- Minimal noice.nvim config (disable as much as possible)
return {
  'folke/noice.nvim',
  event = 'VeryLazy',
  opts = {
    cmdline = { enabled = true },
    messages = { enabled = true, view = 'mini' },
    popupmenu = { enabled = false },
    notify = { enabled = false },
    lsp = {
      progress = { enabled = false },
      hover = { enabled = true },
      signature = { enabled = false },
      message = { enabled = false },
      documentation = { view = nil },
      override = {
        ['vim.lsp.util.convert_input_to_markdown_lines'] = true,
        ['vim.lsp.util.stylize_markdown'] = true,
        ['cmp.entry.get_documentation'] = true,
      },
    },
    health = { checker = false },
    presets = {
      bottom_search = true,
      command_palette = false,
      long_message_to_split = false,
      inc_rename = false,
      lsp_doc_border = false,
    },
    views = {},
    routes = {},
    status = {},
    format = {},
  },
  dependencies = { 'MunifTanjim/nui.nvim' },
}
