local M = {}

local input_float = require 'diff_review_comments.ui.input_float'
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
    'Keys: <CR> open file, e edit comment, dd delete, X clear all, r refresh, q close',
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

local function fmt_comment(comment, repo_root, cache)
  local path = comment.file.repo_relpath or comment.file.abs_path or '[no file]'
  local selected = comment.diff.selected
  local side = utils.side_info(comment.diff.selected_side)
  local first_line = vim.split(comment.comment_text or '', '\n', { plain = true })[1] or ''
  local changed = utils.get_changed_for_comment(repo_root, comment, cache)

  local lines = {
    string.format('[%s] %s (%s)', comment.id, path, side.label),
    string.format('  Lines: %d-%d', selected.line_start, selected.line_end),
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
    state.by_line[start_line] = c
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

  local function clear_all()
    local answer = vim.fn.confirm('Clear all diff review comments for this repo?', '&Yes\n&No', 2)
    if answer == 1 then
      opts.clear_all()
      refresh()
    end
  end

  vim.keymap.set('n', 'q', '<cmd>bdelete<cr>', { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'r', refresh, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'dd', delete_current, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'e', edit_current, { buffer = bufnr, silent = true })
  vim.keymap.set('n', '<CR>', open_current_file, { buffer = bufnr, silent = true })
  vim.keymap.set('n', 'X', clear_all, { buffer = bufnr, silent = true })

  refresh()
end

return M
