local M = {}

local function centered(size)
  local width = math.min(size.width, vim.o.columns - 4)
  local height = math.min(size.height, vim.o.lines - 6)
  return {
    relative = 'editor',
    style = 'minimal',
    border = 'rounded',
    width = width,
    height = height,
    row = math.floor((vim.o.lines - height) / 2) - 1,
    col = math.floor((vim.o.columns - width) / 2),
    title = size.title,
    title_pos = 'center',
    footer = size.footer,
    footer_pos = 'center',
  }
end

function M.open(opts)
  local bufnr = vim.api.nvim_create_buf(false, true)
  local win_config = centered {
    width = 80,
    height = 10,
    title = opts.title or 'Diff Comment',
    footer = opts.footer or 'Submit: <Esc> then <CR>  Cancel: q',
  }

  local ok, win = pcall(vim.api.nvim_open_win, bufnr, true, win_config)
  if not ok then
    win_config.footer = nil
    win_config.footer_pos = nil
    win = vim.api.nvim_open_win(bufnr, true, win_config)
  end

  vim.bo[bufnr].bufhidden = 'wipe'
  vim.bo[bufnr].filetype = 'markdown'

  local initial = opts.initial_text or ''
  local lines = initial == '' and { '' } or vim.split(initial, '\n', { plain = true })
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)

  local function close()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
  end

  local function submit()
    local text = table.concat(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false), '\n')
    if vim.trim(text) == '' then
      return
    end
    close()
    opts.on_submit(text)
  end

  vim.keymap.set('n', '<CR>', submit, { buffer = bufnr, silent = true })
  vim.keymap.set('i', '<C-CR>', submit, { buffer = bufnr, silent = true })
  vim.keymap.set('n', '<Esc>', close, { buffer = bufnr, silent = true })
  vim.keymap.set('i', '<Esc>', '<Esc>', { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'q', close, { buffer = bufnr, silent = true })

  vim.cmd.startinsert()
end

return M
