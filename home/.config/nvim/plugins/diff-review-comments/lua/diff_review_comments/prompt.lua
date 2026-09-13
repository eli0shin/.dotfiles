local M = {}

local utils = require 'diff_review_comments.utils'

local function line_sign_for(selected_side, line_no, changed)
  if selected_side == 'to' and changed.to[line_no] then
    return '+'
  end
  if selected_side == 'from' and changed.from[line_no] then
    return '-'
  end
  return ' '
end

local function format_selected_lines(comment, changed)
  local selected = comment.diff and comment.diff.selected
  if not selected then
    return {}
  end

  local out = {}
  for i, code_line in ipairs(selected.code or {}) do
    local line_no = selected.line_start + i - 1
    local sign = line_sign_for(comment.diff.selected_side, line_no, changed)
    table.insert(out, string.format('%d %s | %s', line_no, sign, code_line))
  end

  return out
end

local function file_reference(comment)
  local rel = comment.file and comment.file.repo_relpath or nil
  if rel and rel ~= '' then
    if rel:sub(1, 1) == '/' then
      return '@' .. rel
    end
    if rel:sub(1, 2) == './' then
      return '@' .. rel
    end
    return '@./' .. rel
  end

  local abs = comment.file and comment.file.abs_path or nil
  if abs and abs ~= '' then
    return '@' .. abs
  end

  return '[unknown]'
end

function M.build(repo_root, comments)
  local changed_cache = {}
  local out = {
    '# Review Feedback',
    '',
    'Total comments: ' .. #comments,
    '',
  }

  for i, c in ipairs(comments) do
    local selected_side = utils.side_info(c.diff.selected_side)
    local changed = utils.get_changed_for_comment(repo_root, c, changed_cache)
    table.insert(out, '## Comment ' .. i)
    table.insert(out, 'File: ' .. file_reference(c))
    table.insert(out, 'Selected side: ' .. selected_side.label)
    table.insert(out, '')

    if c.diff.selected then
      table.insert(out, '### Selected code')
      vim.list_extend(out, format_selected_lines(c, changed))
      table.insert(out, '')
    end

    table.insert(out, '### Comment')
    table.insert(out, c.comment_text)
    table.insert(out, '')
  end

  return table.concat(out, '\n')
end

function M.write_snapshot(prompt_text)
  local dir = vim.fn.stdpath 'data' .. '/diff-review-comments/prompts'
  vim.fn.mkdir(dir, 'p')
  local file = dir .. '/' .. os.date '%Y%m%d-%H%M%S' .. '.md'
  vim.fn.writefile(vim.split(prompt_text, '\n', { plain = true }), file)
  return file
end

return M
