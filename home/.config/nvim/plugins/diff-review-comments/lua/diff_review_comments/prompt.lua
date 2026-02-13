local M = {}

local utils = require 'diff_review_comments.utils'

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

local function compare_value(compare, key)
  local value = compare and compare[key] or nil
  if not value or value == '' then
    return 'unknown'
  end
  return value
end

function M.build(repo_root, comments)
  local changed_cache = {}
  local out = {
    '# Review Requests',
    '',
    'Total comments: ' .. #comments,
    '',
  }

  for i, c in ipairs(comments) do
    local selected_side = utils.side_info(c.diff.selected_side)
    local changed = utils.get_changed_for_comment(repo_root, c, changed_cache)
    local compare = c.diff and c.diff.compare or nil
    table.insert(out, '## Comment ' .. i)
    table.insert(out, 'File: ' .. file_reference(c))
    table.insert(out, 'From commit: ' .. compare_value(compare, 'base'))
    table.insert(out, 'To commit: ' .. compare_value(compare, 'head'))
    table.insert(out, 'From branch: ' .. compare_value(compare, 'base_branch'))
    table.insert(out, 'To branch: ' .. compare_value(compare, 'head_branch'))
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
