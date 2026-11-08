local M = {}

local utils = require 'diff_review_comments.utils'

function M.extract(selection)
  local bufnr = vim.api.nvim_get_current_buf()
  local name = vim.api.nvim_buf_get_name(bufnr)
  if vim.bo[bufnr].buftype ~= '' or name == '' then
    return nil
  end

  local selected = {
    line_start = selection.start.line,
    line_end = selection['end'].line,
    code = utils.get_lines(bufnr, selection.start.line, selection['end'].line),
  }

  return {
    source = {
      extractor = 'buffer',
      buffer_name = name,
      filetype = vim.bo[bufnr].filetype,
    },
    file = {
      abs_path = name,
    },
    diff = {
      side = 'buffer',
      selected_side = 'buffer',
      compare = {},
      selected = selected,
    },
  }
end

return M
