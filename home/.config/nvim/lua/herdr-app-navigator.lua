-- Neovim half of the Herdr app navigator, after vim-tmux-navigator. While
-- Neovim is in front, the app hands it Ctrl+H/J/K/L straight over its RPC
-- server; only a move at a window edge requests a pane change via the core.
local M = {}
local directions = { left = 'h', down = 'j', up = 'k', right = 'l' }
-- Where the app sends the keys. Set only while this editor is in front:
-- cleared on suspend and exit, restored on resume.
local EDITOR_LABEL = 'dotfiles.navigator.editor'
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

local function label(pair, failure)
  local ok, job = pcall(vim.system, { 'hc', 'label', vim.env.HC_TERMINAL_ID, pair }, { text = true }, function(result)
    if result.code ~= 0 then
      notify_failure(result.stderr or failure)
    end
  end)
  if not ok then
    notify_failure(tostring(job))
    return nil
  end
  return job
end

local function claim()
  -- Headless runs (tests, scripts) aren't what the terminal shows.
  if vim.v.servername == '' or #vim.api.nvim_list_uis() == 0 then
    return
  end
  -- The PATH entry survives `brew upgrade`; v:progpath is the versioned keg.
  local nvim = vim.fn.exepath 'nvim'
  local editor = vim.json.encode { nvim = nvim ~= '' and nvim or vim.v.progpath, server = vim.v.servername }
  label(EDITOR_LABEL .. '=' .. editor, 'could not claim the terminal for Neovim')
end

local function release(wait)
  local job = label(EDITOR_LABEL .. '=', 'could not release the terminal')
  -- On exit, wait: a stale claim would send the keys to a dead server.
  if job and wait then
    pcall(job.wait, job, 1000)
  end
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
  label('dotfiles.navigator=' .. token, 'could not request pane navigation')
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
  -- Inside a Neovim :terminal the outer editor owns the Herdr terminal.
  if vim.env.NVIM ~= nil and vim.env.NVIM ~= '' then
    return
  end
  claim()
  local group = vim.api.nvim_create_augroup('herdr-app-navigator', { clear = true })
  vim.api.nvim_create_autocmd('VimResume', { group = group, callback = claim })
  vim.api.nvim_create_autocmd('VimSuspend', {
    group = group,
    callback = function()
      release(false)
    end,
  })
  -- `:detach` keeps the server running without a screen.
  vim.api.nvim_create_autocmd('UILeave', {
    group = group,
    callback = function()
      if #vim.api.nvim_list_uis() == 0 then
        release(false)
      end
    end,
  })
  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = function()
      release(true)
    end,
  })
end

return M
