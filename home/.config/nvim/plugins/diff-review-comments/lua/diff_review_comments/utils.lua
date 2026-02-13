local M = {}

local git_diff_status = require 'diff_review_comments.git_diff_status'

function M.side_info(side)
  if side == 'from' then
    return {
      label = 'OLD (-)',
      sign = '-',
    }
  end
  if side == 'to' then
    return {
      label = 'NEW (+)',
      sign = '+',
    }
  end
  return {
    label = 'UNKNOWN (?)',
    sign = '?',
  }
end

function M.get_lines(bufnr, start_line, end_line)
  local max = vim.api.nvim_buf_line_count(bufnr)
  local safe_end = math.min(max, end_line)
  if safe_end < start_line then
    return {}
  end
  return vim.api.nvim_buf_get_lines(bufnr, start_line - 1, safe_end, false)
end

function M.get_changed_for_comment(repo_root, comment, cache)
  local repo_relpath = comment.file and comment.file.repo_relpath
  local compare = comment.diff and comment.diff.compare or nil
  local base = compare and compare.base or ''
  local head = compare and compare.head or ''
  local cache_key = string.format('%s::%s::%s', repo_relpath or '', base, head)
  if not repo_root or repo_root == '' or not repo_relpath or repo_relpath == '' then
    return {
      from = {},
      to = {},
    }
  end

  local cached = cache[cache_key]
  if cached then
    return cached
  end

  local changed = git_diff_status.get_changed_lines(repo_root, repo_relpath, compare)
  cache[cache_key] = changed
  return changed
end

return M
