local M = {}

local utils = require 'diff_review_comments.utils'

local function timestamp()
  return os.date '!%Y-%m-%dT%H:%M:%SZ'
end

local function code_block(ft, lines)
  local safe_ft = ft and ft ~= '' and ft or 'text'
  local body = table.concat(lines or {}, '\n')
  return string.format('```%s\n%s\n```', safe_ft, body)
end

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
    table.insert(out, string.format('%6d %s | %s', line_no, sign, code_line))
  end

  return out
end

function M.build(repo_root, comments)
  local changed_cache = {}
  local out = {
    '# Review Requests',
    '',
    'Repository: ' .. repo_root,
    'Generated: ' .. timestamp(),
    'Total comments: ' .. #comments,
    '',
  }

  for i, c in ipairs(comments) do
    local selected_side = utils.side_info(c.diff.selected_side)
    local changed = utils.get_changed_for_comment(repo_root, c, changed_cache)
    local file_path = c.file.repo_relpath or c.file.abs_path or '[unknown]'
    local file_ref = file_path == '[unknown]' and file_path or ('@' .. file_path)
    table.insert(out, '## Comment ' .. i)
    table.insert(out, 'Id: ' .. c.id)
    table.insert(out, 'File: ' .. file_ref)
    table.insert(
      out,
      string.format('Selection: L%d:C%d-L%d:C%d', c.selection.start.line, c.selection.start.col, c.selection['end'].line, c.selection['end'].col)
    )
    table.insert(out, 'Diff side: ' .. (c.diff.side or 'unknown'))
    table.insert(out, 'Selected side: ' .. selected_side.label)
    table.insert(out, '')

    if c.diff.selected then
      table.insert(out, '### Selected code')
      table.insert(out, code_block(c.file.filetype, format_selected_lines(c, changed)))
      table.insert(out, '')
    end

    table.insert(out, '### Reviewer comment')
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
