#!/usr/bin/env bash
set -euo pipefail

test_root=$(mktemp -d "${TMPDIR:-/tmp}/nvim-diffview-toggle.XXXXXX")
readonly test_root
trap 'rm -rf "$test_root"' EXIT

readonly test_repo="$test_root/repo"
mkdir -p "$test_repo"
git -C "$test_repo" init -q
git -C "$test_repo" config user.name Test
git -C "$test_repo" config user.email test@example.com
printf 'before\n' >"$test_repo/example.txt"
git -C "$test_repo" add example.txt
git -C "$test_repo" commit -qm initial
printf 'after\n' >"$test_repo/example.txt"

cat >"$test_root/test.lua" <<'LUA'
local function fail(message)
  io.stderr:write('FAIL: ' .. message .. '\n')
  vim.cmd('cquit 1')
end

vim.cmd('DiffviewOpen')
local opened = vim.wait(5000, function()
  local ok, lib = pcall(require, 'diffview.lib')
  if not ok then
    return false
  end

  local view = lib.get_current_view()
  return view and view.panel and view.panel:is_open()
end, 20)

if not opened then
  fail('Diffview did not open')
end

local view = require('diffview.lib').get_current_view()
local toggle = vim.api.nvim_replace_termcodes('<leader>b', true, false, true)
vim.api.nvim_feedkeys(toggle, 'x', false)

if view.panel:is_open() then
  fail('<leader>b did not close the file panel')
end

vim.api.nvim_feedkeys(toggle, 'x', false)
local reopened = vim.wait(1000, function()
  return view.panel:is_open()
end, 10)

if not reopened then
  fail('<leader>b was unavailable after the file panel closed')
end

print('PASS: Diffview file panel toggles in both directions')
vim.cmd('qa!')
LUA

XDG_STATE_HOME="$test_root/state" XDG_CACHE_HOME="$test_root/cache" \
  nvim --headless \
  -c "cd $test_repo" \
  -c "luafile $test_root/test.lua"
