local M = {}

local input_float = require 'diff_review_comments.ui.input_float'
local prompt = require 'diff_review_comments.prompt'
local utils = require 'diff_review_comments.utils'

local state = {
  by_line = {},
}

local function header(repo_root, count)
  return {
    'Diff Review Comments',
    'Repo: ' .. repo_root,
    'Open comments: ' .. count,
    '',
    'Keys: <CR> open file, e edit comment, r run, R run+delete, dd delete, xx/visual x yank+delete, visual d delete, <leader>r refresh, X clear all, q close',
    '',
  }
end

local function line_sign_for(comment, line_no, changed)
  if comment.diff.selected_side == 'to' and changed.to[line_no] then
    return '+'
  end
  if comment.diff.selected_side == 'from' and changed.from[line_no] then
    return '-'
  end
  return ' '
end

local function compare_value(compare, key)
  local value = compare and compare[key] or nil
  if not value or value == '' then
    return 'unknown'
  end
  return value
end

local function format_compare(compare)
  return string.format(
    '  Compare: %s (%s) -> %s (%s)',
    compare_value(compare, 'base_branch'),
    compare_value(compare, 'base'),
    compare_value(compare, 'head_branch'),
    compare_value(compare, 'head')
  )
end

local function fmt_comment(comment, repo_root, cache)
  local path = comment.file.repo_relpath or comment.file.abs_path or '[no file]'
  local selected = comment.diff.selected
  local side = utils.side_info(comment.diff.selected_side)
  local first_line = vim.split(comment.comment_text or '', '\n', { plain = true })[1] or ''
  local changed = utils.get_changed_for_comment(repo_root, comment, cache)
  local compare = comment.diff and comment.diff.compare or nil

  local lines = {
    string.format('[%s] %s (%s)', comment.id, path, side.label),
    string.format('  Lines: %d-%d', selected.line_start, selected.line_end),
    format_compare(compare),
    '  Selected code:',
  }

  for i, code_line in ipairs(selected.code) do
    local line_no = selected.line_start + i - 1
    local sign = line_sign_for(comment, line_no, changed)
    table.insert(lines, string.format('    %6d %s | %s', line_no, sign, code_line))
  end

  table.insert(lines, '  Comment: ' .. first_line)
  table.insert(lines, '')
  return lines
end

local function set_lines(bufnr, lines)
  vim.bo[bufnr].modifiable = true
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
  vim.bo[bufnr].modifiable = false
end

local function render(bufnr, repo_root, comments)
  state.by_line = {}
  local changed_cache = {}
  local lines = header(repo_root, #comments)

  for _, c in ipairs(comments) do
    local start_line = #lines + 1
    local chunk = fmt_comment(c, repo_root, changed_cache)
    for _, line in ipairs(chunk) do
      table.insert(lines, line)
    end
    for line = start_line, #lines do
      state.by_line[line] = c
    end
  end

  if #comments == 0 then
    table.insert(lines, 'No open comments.')
  end

  set_lines(bufnr, lines)
end

local function find_comment_at_cursor()
  local line = vim.api.nvim_win_get_cursor(0)[1]
  for l = line, 1, -1 do
    if state.by_line[l] then
      return state.by_line[l]
    end
  end
  return nil
end

local function find_comments_in_range(start_line, end_line)
  if start_line > end_line then
    start_line, end_line = end_line, start_line
  end

  local comments = {}
  local seen = {}
  for l = start_line, end_line do
    local comment = state.by_line[l]
    if comment and not seen[comment.id] then
      table.insert(comments, comment)
      seen[comment.id] = true
    end
  end
  return comments
end

function M.open(opts)
  vim.cmd 'enew'
  local bufnr = vim.api.nvim_get_current_buf()

  vim.bo[bufnr].buftype = 'nofile'
  vim.bo[bufnr].bufhidden = 'wipe'
  vim.bo[bufnr].swapfile = false
  vim.bo[bufnr].filetype = 'diff-review-comments'

  local function refresh()
    local comments = opts.get_comments()
    render(bufnr, opts.repo_root, comments)
  end

  local function delete_current()
    local c = find_comment_at_cursor()
    if not c then
      return
    end
    opts.delete_comment(c)
    refresh()
  end

  local function comments_from_visual_selection()
    -- Read the live selection from within the Visual-mode mapping. The '< and
    -- '> marks are only updated when leaving Visual mode, so they hold the
    -- previous selection here; getpos('v')/getpos('.') give the current bounds.
    local start_line = vim.fn.getpos('v')[2]
    local end_line = vim.fn.getpos('.')[2]
    local comments = find_comments_in_range(start_line, end_line)
    if #comments == 0 then
      local c = find_comment_at_cursor()
      if c then
        comments = { c }
      end
    end
    return comments
  end

  local function delete_visual_selection()
    local comments = comments_from_visual_selection()
    for _, c in ipairs(comments) do
      opts.delete_comment(c)
    end
    if #comments > 0 then
      refresh()
    end
  end

  local function yank_then_delete_comments(comments)
    if #comments == 0 then
      return
    end

    local text = prompt.build(opts.repo_root, comments)
    vim.fn.setreg('"', text)
    if vim.fn.has 'clipboard' == 1 then
      vim.fn.setreg('+', text)
    end

    for _, c in ipairs(comments) do
      opts.delete_comment(c)
    end
    refresh()
    vim.notify(string.format('Yanked and deleted %d diff review comment(s)', #comments))
  end

  local function yank_then_delete_current()
    local c = find_comment_at_cursor()
    if c then
      yank_then_delete_comments { c }
    end
  end

  local function yank_then_delete_visual_selection()
    yank_then_delete_comments(comments_from_visual_selection())
  end

  local function edit_current()
    local c = find_comment_at_cursor()
    if not c then
      return
    end
    input_float.open {
      title = string.format('Edit Comment %s (%s)', c.id, utils.side_info(c.diff.selected_side).label),
      initial_text = c.comment_text,
      on_submit = function(text)
        opts.update_comment(c, text)
        refresh()
      end,
    }
  end

  local function open_current_file()
    local c = find_comment_at_cursor()
    if not c then
      return
    end
    local path = c.file.abs_path
    if not path or path == '' then
      return
    end
    vim.cmd('edit ' .. vim.fn.fnameescape(path))
    vim.api.nvim_win_set_cursor(0, { c.selection.start.line, math.max(c.selection.start.col - 1, 0) })
  end

  local function run_current()
    local c = find_comment_at_cursor()
    if c and opts.run_comments then
      opts.run_comments { c }
    end
  end

  local function run_visual_selection()
    local comments = comments_from_visual_selection()
    if #comments > 0 and opts.run_comments then
      opts.run_comments(comments)
    end
  end

  local function run_then_delete_current()
    local c = find_comment_at_cursor()
    if c and opts.run_comments then
      opts.run_comments { c }
      opts.delete_comment(c)
      refresh()
    end
  end

  local function run_then_delete_visual_selection()
    local comments = comments_from_visual_selection()
    if #comments > 0 and opts.run_comments then
      opts.run_comments(comments)
      for _, c in ipairs(comments) do
        opts.delete_comment(c)
      end
      refresh()
    end
  end

  local function clear_all()
    local answer = vim.fn.confirm('Clear all diff review comments for this repo?', '&Yes\n&No', 2)
    if answer == 1 then
      opts.clear_all()
      refresh()
    end
  end

  vim.keymap.set('n', 'q', '<cmd>bdelete<cr>', { buffer = bufnr, silent = true })
  vim.keymap.set('n', '<leader>r', refresh, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'dd', delete_current, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'xx', yank_then_delete_current, { buffer = bufnr, silent = true })
  vim.keymap.set('x', 'd', delete_visual_selection, { buffer = bufnr, silent = true })
  vim.keymap.set('x', 'x', yank_then_delete_visual_selection, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'e', edit_current, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'r', run_current, { buffer = bufnr, silent = true })
  vim.keymap.set('x', 'r', run_visual_selection, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'R', run_then_delete_current, { buffer = bufnr, silent = true })
  vim.keymap.set('x', 'R', run_then_delete_visual_selection, { buffer = bufnr, silent = true })
  vim.keymap.set('n', '<CR>', open_current_file, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'X', clear_all, { buffer = bufnr, silent = true })

  refresh()
end

return M
