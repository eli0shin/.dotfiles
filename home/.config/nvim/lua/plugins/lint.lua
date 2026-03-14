return {
  { -- Linting
    'mfussenegger/nvim-lint',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local lint = require 'lint'
      local has_config = require 'utils.has_config'

      -- No static linters_by_ft — linters are selected dynamically
      -- based on project config files in the autocmd below.
      -- ESLint runs via LSP (see lsp.lua), not nvim-lint.
      lint.linters_by_ft = {}

      local web_fts = {
        javascript = true,
        javascriptreact = true,
        typescript = true,
        typescriptreact = true,
      }

      local lint_augroup = vim.api.nvim_create_augroup('lint', { clear = true })
      vim.api.nvim_create_autocmd({ 'BufEnter', 'BufWritePost', 'InsertLeave' }, {
        group = lint_augroup,
        callback = function()
          local bufnr = vim.api.nvim_get_current_buf()
          local ft = vim.bo[bufnr].filetype
          local dirname = vim.fs.dirname(vim.api.nvim_buf_get_name(bufnr))

          if web_fts[ft] then
            -- Priority: oxlint > biome. ESLint handled by LSP.
            if has_config(dirname, 'oxlint') then
              lint.try_lint({ 'oxlint' }, { ignore_errors = true })
            elseif has_config(dirname, 'biome') then
              lint.try_lint({ 'biomejs' }, { ignore_errors = true })
            end
          end
        end,
      })
    end,
  },
}
