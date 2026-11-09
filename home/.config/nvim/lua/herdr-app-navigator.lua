-- Neovim half of the Herdr app navigator. The app forwards editor keys;
-- only a move at a window edge requests a pane change via the owning core.
local M = {}
local directions = { left = 'h', down = 'j', up = 'k', right = 'l' }
-- Claims the terminal's foreground process group, so the app forwards keys
-- even when Neovim isn't the group leader it reports (a wrapper script,
-- `git commit`, an agent's external editor).
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

local function label(pair, on_exit)
  return pcall(vim.system, { 'hc', 'label', vim.env.HC_TERMINAL_ID, pair }, { text = true }, on_exit)
end

-- The process group the terminal has in front while this editor runs. Since
-- Neovim 0.10 the TUI is the parent of this `--embed` server, which has its
-- own group.
local function foreground_group()
  local ok, ffi = pcall(require, 'ffi')
  if not ok then
    return nil
  end
  pcall(ffi.cdef, 'int getpgid(int pid);')
  local pid = vim.tbl_contains(vim.v.argv, '--embed') and vim.uv.os_getppid() or 0
  local found, group = pcall(function()
    return ffi.C.getpgid(pid)
  end)
  if found and group > 0 then
    return group
  end
end

local function claim_foreground()
  local group = foreground_group()
  if not group then
    return
  end
  local ok, err = label(EDITOR_LABEL .. '=' .. group, function(result)
    if result.code ~= 0 then
      notify_failure(result.stderr or 'could not claim the terminal for Neovim')
    end
  end)
  if not ok then
    notify_failure(tostring(err))
  end
end

local function release_foreground()
  -- Synchronous: Neovim is exiting, and a stale claim would keep forwarding
  -- keys to whatever else shares the group (a wrapping agent, git).
  local ok, job = label(EDITOR_LABEL .. '=')
  if ok then
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
  local ok, err = label('dotfiles.navigator=' .. token, function(result)
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
  -- Inside a Neovim :terminal the outer editor owns the Herdr terminal.
  if vim.env.NVIM ~= nil and vim.env.NVIM ~= '' then
    return
  end
  claim_foreground()
  local group = vim.api.nvim_create_augroup('herdr-app-navigator', { clear = true })
  -- Another Neovim started while this one was suspended may have released it.
  vim.api.nvim_create_autocmd('VimResume', { group = group, callback = claim_foreground })
  vim.api.nvim_create_autocmd('VimLeavePre', { group = group, callback = release_foreground })
end

return M
