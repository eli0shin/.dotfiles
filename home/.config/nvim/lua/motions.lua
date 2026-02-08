-- Set <space> as the leader key
-- See `:help mapleader`
--  NOTE: Must happen before plugins are loaded (otherwise wrong leader will be used)
vim.g.mapleader = ' '
vim.g.maplocalleader = ' '

vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')

-- Diagnostic keymaps
vim.keymap.set('n', '[d', function() vim.diagnostic.jump({ count = -1 }) end, { desc = 'Go to previous [D]iagnostic message' })
vim.keymap.set('n', ']d', function() vim.diagnostic.jump({ count = 1 }) end, { desc = 'Go to next [D]iagnostic message' })
vim.keymap.set('n', '<leader>e', vim.diagnostic.open_float, { desc = 'Show diagnostic [E]rror messages' })
vim.keymap.set('n', '<leader>q', vim.diagnostic.setloclist, { desc = 'Open diagnostic [Q]uickfix list' })

-- Exit terminal mode in the builtin terminal with a shortcut that is a bit easier
-- for people to discover. Otherwise, you normally need to press <C-\><C-n>, which
-- is not what someone will guess without a bit more experience.
--
-- NOTE: This won't work in all terminal emulators/tmux/etc. Try your own mapping
-- or just use <C-\><C-n> to exit terminal mode
vim.keymap.set('t', '<Esc><Esc>', '<C-\\><C-n>', { desc = 'Exit terminal mode' })
vim.keymap.set('t', '<C-Space>', '<C-\\><C-n>', { desc = 'Exit terminal mode (safe)' })

-- Send literal Escape key to terminal applications when pressing Shift+Escape
-- This allows apps like Claude Code to receive Escape key presses
vim.keymap.set('t', '<S-Esc>', function()
  local buf = vim.api.nvim_get_current_buf()
  local chan_id = vim.b[buf].terminal_job_id
  if chan_id then
    vim.api.nvim_chan_send(chan_id, string.char(27)) -- ASCII 27 is ESC
  end
end, { desc = 'Send literal Escape key to terminal' })

-- Clear terminal scrollback (works in normal mode when viewing a terminal buffer)
vim.keymap.set('n', '<leader>k', function()
  local buf = vim.api.nvim_get_current_buf()
  if vim.bo[buf].buftype ~= 'terminal' then
    return
  end
  -- The scrollback hack: set to 1 to clear, then restore
  local saved_scrollback = vim.bo[buf].scrollback
  vim.bo[buf].scrollback = 1
  vim.cmd('sleep 100m')
  vim.bo[buf].scrollback = saved_scrollback
  -- Send clear to shell to redraw prompt
  local chan_id = vim.b[buf].terminal_job_id
  if chan_id then
    vim.api.nvim_chan_send(chan_id, 'clear\n')
  end
end, { desc = 'Clear terminal scrollback' })

-- TIP: Disable arrow keys in normal mode
-- vim.keymap.set('n', '<left>', '<cmd>echo "Use h to move!!"<CR>')
-- vim.keymap.set('n', '<right>', '<cmd>echo "Use l to move!!"<CR>')
-- vim.keymap.set('n', '<up>', '<cmd>echo "Use k to move!!"<CR>')
-- vim.keymap.set('n', '<down>', '<cmd>echo "Use j to move!!"<CR>')

-- Keybindings to make split navigation easier.
--  Use CTRL+<hjkl> to switch between windows
--
--  See `:help wincmd` for a list of all window commands
vim.keymap.set('n', '<C-h>', '<C-w><C-h>', { desc = 'Move focus to the left window', remap = true })
vim.keymap.set('n', '<C-l>', '<C-w><C-l>', { desc = 'Move focus to the right window', remap = true })
vim.keymap.set('n', '<C-j>', '<C-w><C-j>', { desc = 'Move focus to the lower window', remap = true })
vim.keymap.set('n', '<C-k>', '<C-w><C-k>', { desc = 'Move focus to the upper window', remap = true })

-- Split windows
vim.keymap.set('n', '<Leader>h', ':split<CR>', { silent = true, desc = 'Split window horizontally' })
vim.keymap.set('n', '<Leader>v', ':vsplit<CR>', { silent = true, desc = 'Split window vertically' })

-- remap ; to  : in normal mode
vim.keymap.set({ 'n', 'x', 'o', 'v' }, ';', ':', { remap = true })
