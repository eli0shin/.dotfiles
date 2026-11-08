-- Run from the repo root: nvim --headless -u NONE -l tests/herdr-app-navigation.lua
vim.opt.rtp:prepend(vim.fn.getcwd() .. '/home/.config/nvim')
vim.env.HERDR_ENV = nil
vim.env.TMUX = nil
vim.env.HC_TERMINAL_ID = 'test-navigation'
local requests = {}
vim.system = function(argv, _, callback)
  requests[#requests + 1] = argv
  if callback then
    callback { code = 0, stdout = '', stderr = '' }
  end
  return {}
end

local navigator = require 'herdr-app-navigator'
assert(navigator.active())
navigator.setup()
local directions = { left = 'h', down = 'j', up = 'k', right = 'l' }
local function press(key)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<C-' .. key .. '>', true, false, true), 'xt', false)
end
local function expect_edge(direction)
  local count = #requests
  press(directions[direction])
  assert(#requests == count + 1, direction .. ' edge must hand off to Herdr')
  local request = requests[#requests]
  assert(request[1] == 'hc' and request[2] == 'label' and request[3] == 'test-navigation')
  assert(request[4]:match('^dotfiles%.navigator=%d+:%d+:' .. direction .. '$'))
end

-- Real Neovim windows and the installed Ctrl mappings, not mocked wincmd.
vim.cmd.vsplit()
local left = vim.api.nvim_get_current_win()
vim.cmd 'wincmd l'
local right = vim.api.nvim_get_current_win()
assert(left ~= right)
press 'h'
assert(vim.api.nvim_get_current_win() == left and #requests == 0)
press 'l'
assert(vim.api.nvim_get_current_win() == right and #requests == 0)
expect_edge 'right'
vim.cmd 'wincmd h'
expect_edge 'left'
vim.cmd 'only'
vim.cmd.split()
local top = vim.api.nvim_get_current_win()
vim.cmd 'wincmd j'
local bottom = vim.api.nvim_get_current_win()
assert(top ~= bottom)
local count = #requests
press 'k'
assert(vim.api.nvim_get_current_win() == top and #requests == count)
press 'j'
assert(vim.api.nvim_get_current_win() == bottom and #requests == count)
expect_edge 'down'
vim.cmd 'wincmd k'
expect_edge 'up'
local previous = requests[#requests][4]
expect_edge 'up'
assert(requests[#requests][4] ~= previous, 'repeated edge requests need unique tokens')

vim.env.TMUX = '/tmp/test-tmux'
assert(not navigator.active(), 'nested tmux must retain its own navigator')
vim.env.TMUX = nil
vim.env.HERDR_ENV = '1'
assert(not navigator.active(), 'legacy Herdr must retain its existing plugin')
vim.env.HERDR_ENV = nil
vim.env.HC_TERMINAL_ID = nil
assert(not navigator.active(), 'ordinary terminals must remain unchanged')
print('PASS: real Neovim Ctrl+H/J/K/L mappings cross splits, hand off only at edges, and preserve other environments')
vim.cmd 'qa!'
