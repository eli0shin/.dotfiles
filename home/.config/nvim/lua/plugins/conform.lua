vim.api.nvim_create_user_command('FormatDisable', function(args)
  if args.bang then
    -- FormatDisable! will disable formatting just for this buffer
    vim.b.disable_autoformat = true
  else
    vim.g.disable_autoformat = true
  end
end, {
  desc = 'Disable autoformat-on-save',
  bang = true,
})

vim.api.nvim_create_user_command('FormatEnable', function()
  vim.b.disable_autoformat = false
  vim.g.disable_autoformat = false
end, {
  desc = 'Re-enable autoformat-on-save',
})

-- Filetypes where formatting depends on project config detection.
-- LSP fallback is disabled for these — no config means no formatting.
local config_dependent_fts = {
  javascript = true,
  javascriptreact = true,
  typescript = true,
  typescriptreact = true,
  json = true,
  markdown = true,
  graphql = true,
  html = true,
  css = true,
  c = true,
  cpp = true,
}

return { -- Autoformat
  'stevearc/conform.nvim',
  lazy = true,
  event = 'VeryLazy',
  keys = {
    {
      '<leader>f',
      function()
        local ft = vim.bo.filetype
        require('conform').format { async = true, lsp_fallback = not config_dependent_fts[ft] }
      end,
      mode = '',
      desc = '[F]ormat buffer',
    },
  },
  opts = {
    notify_on_error = true,
    format_on_save = function(bufnr)
      if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
        return
      end
      local ft = vim.bo[bufnr].filetype
      return {
        timeout_ms = 1000,
        lsp_fallback = not config_dependent_fts[ft],
      }
    end,
    formatters = {
      oxfmt = {
        command = 'oxfmt',
        args = { '--stdin-filepath', '$FILENAME' },
        stdin = true,
        condition = function(self, ctx)
          return require('utils.has_config')(ctx.dirname, 'oxfmt')
        end,
      },
      biome = {
        condition = function(self, ctx)
          return require('utils.has_config')(ctx.dirname, 'biome')
        end,
      },
      deno_fmt = {
        condition = function(self, ctx)
          return require('utils.has_config')(ctx.dirname, 'deno')
        end,
      },
      prettier = {
        prepend_args = { '--quote-props=preserve' },
        condition = function(self, ctx)
          return require('utils.has_config')(ctx.dirname, 'prettier')
        end,
      },
    },
    formatters_by_ft = {
      lua = { 'stylua' },
      javascript = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
      javascriptreact = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
      typescript = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
      typescriptreact = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
      json = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
      markdown = { 'oxfmt', 'prettier', stop_after_first = true },
      graphql = { 'oxfmt', 'prettier', stop_after_first = true },
      html = { 'oxfmt', 'prettier', stop_after_first = true },
      css = { 'oxfmt', 'biome', 'prettier', stop_after_first = true },
      go = { 'gofmt', 'goimports' },
    },
  },
}
