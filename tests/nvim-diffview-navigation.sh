#!/usr/bin/env bash
set -euo pipefail

test_root=$(mktemp -d "${TMPDIR:-/tmp}/nvim-diffview-navigation.XXXXXX")
readonly test_root
trap 'rm -rf "$test_root"' EXIT

readonly test_repo="$test_root/repo"
mkdir -p "$test_repo"
git -C "$test_repo" init -q
git -C "$test_repo" config user.name Test
git -C "$test_repo" config user.email test@example.com
printf 'one\n' >"$test_repo/a.txt"
printf 'one\n' >"$test_repo/b.txt"
git -C "$test_repo" add .
git -C "$test_repo" commit -qm initial
printf 'two\n' >>"$test_repo/a.txt"
printf 'two\n' >>"$test_repo/b.txt"
git -C "$test_repo" add .
git -C "$test_repo" commit -qm update

cat >"$test_root/test.lua" <<'LUA'
local function fail(message)
  io.stderr:write('FAIL: ' .. message .. '\n')
  vim.cmd('cquit 1')
end

vim.cmd('DiffviewFileHistory --range=HEAD~1..HEAD')
local opened = vim.wait(5000, function()
  local ok, lib = pcall(require, 'diffview.lib')
  return ok and lib.get_current_view() ~= nil
end, 20)

if not opened then
  fail('Diffview file history did not open')
end

vim.wait(200)

local slipped_keys = 0
vim.keymap.set('n', '<M-j>', function() slipped_keys = slipped_keys + 1 end)
vim.keymap.set('n', '<M-k>', function() slipped_keys = slipped_keys + 1 end)

for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
  local bufnr = vim.api.nvim_win_get_buf(win)
  if vim.bo[bufnr].filetype ~= 'DiffviewFileHistory' then
    vim.api.nvim_set_current_win(win)
    break
  end
end

local next_file = vim.api.nvim_replace_termcodes('<M-j>', true, false, true)
vim.api.nvim_feedkeys(next_file, 'x', false)
vim.api.nvim_feedkeys(next_file, 'x', false)
vim.wait(500)

if slipped_keys > 0 then
  fail('rapid Option-J/K reached the global split-resize mapping')
end

print('PASS: Diffview file navigation does not reach global mappings')
vim.cmd('qa!')
LUA

XDG_STATE_HOME="$test_root/state" XDG_CACHE_HOME="$test_root/cache" \
  nvim --headless \
  -c "cd $test_repo" \
  -c "luafile $test_root/test.lua"
