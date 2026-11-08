-- Neovim half of the Herdr app navigator. The app forwards editor keys;
-- only a move at a window edge requests a pane change via the owning core.
local M = {}
local directions = { left = 'h', down = 'j', up = 'k', right = 'l' }
local failure_notified = false

function M.active()
  return vim.env.HC_TERMINAL_ID ~= nil
    and vim.env.HC_TERMINAL_ID ~= ''
    and vim.env.HERDR_ENV ~= '1'
    and (vim.env.TMUX == nil or vim.env.TMUX == '')
end

local function notify_failure(message)
  vim.schedule(function()
    if failure_notified then
      return
    end
    failure_notified = true
    vim.notify('Herdr app navigation: ' .. message, vim.log.levels.ERROR)
  end)
end

function M.navigate(direction)
  assert(directions[direction], 'Invalid navigation direction: ' .. tostring(direction))
  local window = vim.api.nvim_get_current_win()
  vim.cmd.wincmd(directions[direction])
  if vim.api.nvim_get_current_win() ~= window then
    return
  end

  -- Unique on every press, including repeated attempts at the same edge.
  -- The app consumes the label only while this terminal still has focus.
  local token = string.format('%d:%.0f:%s', vim.fn.getpid(), vim.uv.hrtime(), direction)
  local ok, err = pcall(vim.system, {
    'hc',
    'label',
    vim.env.HC_TERMINAL_ID,
    'dotfiles.navigator=' .. token,
  }, { text = true }, function(result)
    if result.code ~= 0 then
      notify_failure(result.stderr or 'could not request pane navigation')
    end
  end)
  if not ok then
    notify_failure(tostring(err))
  end
end

function M.setup()
  if not M.active() then
    return
  end
  for direction, key in pairs(directions) do
    vim.keymap.set('n', '<C-' .. key .. '>', function()
      M.navigate(direction)
    end, { silent = true, desc = 'Go to window / Herdr app pane ' .. direction })
  end
end

return M
