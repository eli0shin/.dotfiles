local M = {}

function M.copy(text)
  vim.fn.setreg('"', text)
  if vim.fn.has 'clipboard' == 1 then
    vim.fn.setreg('+', text)
  end
end

return M
