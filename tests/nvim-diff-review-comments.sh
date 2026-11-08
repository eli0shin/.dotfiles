#!/usr/bin/env bash
set -euo pipefail

readonly dotfiles_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/nvim-diff-review-comments.XXXXXX")
readonly test_root
readonly review_root="/tmp/review/current/diff-review-comments-test/$(basename "$test_root")"
trap 'rm -rf "$test_root" "$review_root"' EXIT

mkdir -p "$test_root/repo"
git -C "$test_root/repo" init -qb main
git -C "$test_root/repo" config user.name Test
git -C "$test_root/repo" config user.email test@example.com
git -C "$test_root/repo" remote add origin "git@github.com:diff-review-comments-test/$(basename "$test_root").git"
printf 'first\nsecond\nthird\n' >"$test_root/repo/example.txt"
git -C "$test_root/repo" add example.txt
git -C "$test_root/repo" commit -qm initial

cat >"$test_root/test.lua" <<'LUA'
local function run()
  vim.opt.runtimepath:append(vim.env.PLUGIN_ROOT)
  vim.env.PR_DIFF_URL = nil
  vim.g.mapleader = ' '
  local test_root = vim.uv.fs_realpath(vim.env.TEST_ROOT)
  local repo = test_root .. '/repo'
  local storage = test_root .. '/comments.json'
  local review_path = vim.env.REVIEW_ROOT .. '/main.txt'
  local context = require 'diff_review_comments.context'
  local plugin = require 'diff_review_comments'
  local store = require 'diff_review_comments.store'
  local review_file = require 'diff_review_comments.review_file'
  local input = require 'diff_review_comments.ui.input_float'
  local clipboard = require 'diff_review_comments.clipboard'
  local next_text = 'Review unchanged code'
  local copied
  local input_title
  input.open = function(opts)
    input_title = opts.title
    opts.on_submit(next_text)
  end
  clipboard.copy = function(text)
    copied = text
  end
  plugin.setup { storage_path = storage, notify = false }

  local function keys(text)
    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(text, true, false, true), 'xt', false)
  end

  local function select_lines(first, last)
    vim.fn.setpos("'<", { 0, first, 1, 0 })
    vim.fn.setpos("'>", { 0, last, 1, 0 })
  end

  local function comments()
    return store.get_open_comments(storage, repo)
  end

  local function review_text()
    return table.concat(vim.fn.readfile(review_path), '\n')
  end

  -- Resolve the repository from the file, not Neovim's working directory.
  vim.cmd('cd ' .. vim.fn.fnameescape(test_root))
  vim.cmd('edit ' .. vim.fn.fnameescape(repo .. '/example.txt'))
  local file_buf = vim.api.nvim_get_current_buf()
  assert(not vim.wo.diff)
  select_lines(1, 2)
  local captured, err = context.capture(200)
  assert(captured, err)
  assert(captured.repo_root == repo)
  assert(captured.extracted.source.extractor == 'buffer')
  assert(captured.extracted.file.repo_relpath == 'example.txt')
  assert(captured.extracted.diff.side == 'buffer')
  assert(captured.extracted.diff.selected_side == 'buffer')
  assert(captured.extracted.diff.from == nil and captured.extracted.diff.to == nil)
  assert(captured.extracted.diff.compare.head_branch == 'main')
  assert(vim.deep_equal(captured.extracted.diff.selected.code, { 'first', 'second' }))
  assert(#context.capture(1).extracted.diff.selected.code == 1)
  assert(review_file.path(repo) == review_path)

  -- The actual visual mapping saves an unchanged file selection on main.
  keys('ggVj dca<Esc>')
  assert(#comments() == 1)
  assert(comments()[1].selection.start.line == 1)
  assert(comments()[1].selection['end'].line == 2)
  assert(review_text():find('File: @./example.txt', 1, true))
  assert(input_title == 'Comment example.txt')
  assert(not review_text():find('Selected side:', 1, true))
  assert(not review_text():find('NEW (+)', 1, true))
  assert(review_text():find('1   | first', 1, true))
  assert(review_text():find(next_text, 1, true))

  -- Operator mapping captures the current buffer, including unsaved edits.
  vim.api.nvim_buf_set_lines(0, 2, 3, false, { 'unsaved third' })
  next_text = 'Review unsaved code'
  keys('3G dca_')
  assert(#comments() == 2)
  assert(comments()[2].selection.start.line == 3)
  assert(vim.deep_equal(comments()[2].diff.selected.code, { 'unsaved third' }))
  assert(review_text():find('unsaved third', 1, true))
  -- Even saved working-tree changes must not be marked as additions.
  vim.cmd 'write'
  local changed = require('diff_review_comments.git_diff_status').get_changed_lines(repo, 'example.txt', {})
  assert(changed.to[3])
  plugin.yank_comments()
  assert(copied:find('Total comments: 2', 1, true))
  assert(copied:find('Review unsaved code', 1, true))
  assert(not copied:find('Selected side:', 1, true))
  assert(copied:find('3   | unsaved third', 1, true))
  assert(not copied:find('NEW (+)', 1, true))
  assert(not copied:find('3 + |', 1, true))

  -- Existing list, edit, delete and cut actions work for file comments.
  plugin.list_comments()
  local list_lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  local list_text = table.concat(list_lines, '\n')
  assert(vim.tbl_contains(list_lines, 'example.txt'))
  assert(not list_text:find('(BUFFER)', 1, true))
  assert(not list_text:find('NEW (+)', 1, true))
  assert(not list_text:find('3 + |', 1, true))
  for line, text in ipairs(list_lines) do
    if text:find('example.txt', 1, true) then
      vim.api.nvim_win_set_cursor(0, { line, 0 })
      break
    end
  end
  next_text = 'Updated review'
  vim.fn.maparg('e', 'n', false, true).callback()
  assert(comments()[1].comment_text == next_text)
  assert(input_title == 'Edit Comment ' .. comments()[1].id)
  assert(review_text():find(next_text, 1, true))
  vim.fn.maparg('dd', 'n', false, true).callback()
  assert(#comments() == 1)
  assert(not review_text():find('Updated review', 1, true))
  vim.cmd 'bdelete!'
  vim.api.nvim_set_current_buf(file_buf)
  plugin.cut_comments()
  assert(#comments() == 0)
  assert(vim.fn.filereadable(review_path) == 0)

  -- Untracked/new files work, and slash-containing branches keep their name.
  vim.cmd('edit! ' .. vim.fn.fnameescape(repo .. '/new.txt'))
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { 'new file' })
  assert(vim.system({ 'git', '-C', repo, 'checkout', '-qb', 'feature/topic' }):wait().code == 0)
  select_lines(1, 1)
  plugin.add_from_visual()
  local branch_path = vim.env.REVIEW_ROOT .. '/feature/topic.txt'
  assert(review_file.path(repo) == branch_path)
  assert(vim.fn.filereadable(branch_path) == 1)
  assert(comments()[1].file.repo_relpath == 'new.txt')
  plugin.cut_comments()
  assert(vim.fn.filereadable(branch_path) == 0)

  -- Reject unnamed and special buffers instead of annotating plugin UI text.
  vim.cmd 'enew!'
  select_lines(1, 1)
  assert(context.capture(200) == nil)
  vim.api.nvim_buf_set_name(0, test_root .. '/scratch')
  for _, buftype in ipairs { 'nofile', 'help', 'prompt' } do
    vim.bo.buftype = buftype
    assert(context.capture(200) == nil, 'Accepted buftype ' .. buftype)
  end
  vim.cmd 'enew!'
  vim.fn.jobstart({ 'sh', '-c', 'printf terminal' }, { term = true })
  select_lines(1, 1)
  assert(context.capture(200) == nil, 'Accepted terminal buffer')

  -- Diff extractors must still take precedence over ordinary file capture.
  vim.cmd('edit! ' .. vim.fn.fnameescape(repo .. '/example.txt'))
  vim.cmd 'diffthis'
  vim.cmd('vsplit ' .. vim.fn.fnameescape(repo .. '/peer.txt'))
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { 'peer' })
  vim.cmd 'diffthis'
  select_lines(1, 1)
  captured = assert(context.capture(200))
  assert(captured.extracted.source.extractor == 'generic')
  assert(captured.extracted.diff.from and captured.extracted.diff.to)
  local utils = require 'diff_review_comments.utils'
  assert(utils.side_info('to').label == 'NEW (+)')
  assert(utils.side_info('from').label == 'OLD (-)')
  assert(utils.side_suffix('to') == ' (NEW (+))')
  assert(utils.side_suffix('from') == ' (OLD (-))')
  vim.cmd 'diffoff!'
  vim.b.octo_diff_props = { path = repo .. '/example.txt', split = 'LEFT' }
  captured = assert(context.capture(200))
  assert(captured.extracted.source.extractor == 'octo')
  assert(captured.extracted.diff.selected_side == 'from')
  vim.b.octo_diff_props = nil
  package.loaded['diffview.lib'] = {
    get_current_view = function()
      return {
        cur_entry = {
          layout = {
            files = function()
              return { { bufnr = vim.api.nvim_get_current_buf(), symbol = 'a', path = repo .. '/example.txt' } }
            end,
          },
          revs = { a = { commit = 'base' }, b = { commit = 'head' } },
        },
      }
    end,
  }
  captured = assert(context.capture(200))
  assert(captured.extracted.source.extractor == 'diffview')
  assert(captured.extracted.diff.selected_side == 'from')
  assert(captured.extracted.diff.compare.base == 'base')
end

local ok, err = xpcall(run, debug.traceback)
if not ok then
  io.stderr:write('FAIL: ' .. err .. '\n')
  vim.cmd 'cquit 1'
end
print('PASS: file buffer comments, branch review files, and diff extractor precedence')
vim.cmd 'qa!'
LUA

TEST_ROOT="$test_root" REVIEW_ROOT="$review_root" \
  PLUGIN_ROOT="$dotfiles_root/home/.config/nvim/plugins/diff-review-comments" \
  nvim --headless -u NONE -i NONE -n -c "luafile $test_root/test.lua"
