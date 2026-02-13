local M = {}

local diffview = require 'diff_review_comments.extractors.diffview'
local octo = require 'diff_review_comments.extractors.octo'
local generic = require 'diff_review_comments.extractors.generic'

local function repo_root()
  local file = vim.api.nvim_buf_get_name(0)
  if file == '' then
    local cwd = vim.fn.getcwd()
    if vim.fs and vim.fs.root then
      return vim.fs.root(cwd, { '.git' }) or cwd
    end
    return cwd
  end

  local dir = vim.fn.fnamemodify(file, ':h')
  local root = vim.fs and vim.fs.root and vim.fs.root(dir, { '.git' }) or nil
  return root or vim.fn.getcwd()
end

function M.current_repo_root()
  return repo_root()
end

local function relpath(abs_path, base)
  if not abs_path or abs_path == '' then
    return nil
  end
  if abs_path:sub(1, #base) == base then
    local rest = abs_path:sub(#base + 1)
    if rest:sub(1, 1) == '/' then
      rest = rest:sub(2)
    end
    return rest
  end
  return abs_path
end

local function get_selection(max_lines)
  local mode = vim.fn.mode(1)
  local visual_active = mode:sub(1, 1) == 'v' or mode:sub(1, 1) == 'V' or mode:sub(1, 1) == '\22'

  local start_pos
  local end_pos
  if visual_active then
    start_pos = vim.fn.getpos('v')
    end_pos = vim.fn.getpos('.')
  else
    start_pos = vim.fn.getpos("'<")
    end_pos = vim.fn.getpos("'>")
  end

  if start_pos[2] == 0 or end_pos[2] == 0 then
    return nil
  end

  local s_line = start_pos[2]
  local s_col = start_pos[3]
  local e_line = end_pos[2]
  local e_col = end_pos[3]

  if s_line > e_line or (s_line == e_line and s_col > e_col) then
    s_line, e_line = e_line, s_line
    s_col, e_col = e_col, s_col
  end

  if max_lines and (e_line - s_line + 1) > max_lines then
    e_line = s_line + max_lines - 1
  end

  return {
    start = { line = s_line, col = s_col },
    ["end"] = { line = e_line, col = e_col },
  }
end

function M.capture(max_lines)
  local selection = get_selection(max_lines)
  if not selection then
    return nil, 'No visual selection found'
  end

  local extracted = diffview.extract(selection) or octo.extract(selection) or generic.extract(selection)
  if not extracted then
    return nil, 'Current buffer is not a diff view'
  end

  local root = repo_root()
  local abs_path = extracted.file.abs_path or vim.api.nvim_buf_get_name(0)
  extracted.file.repo_relpath = relpath(abs_path, root)
  extracted.file.filetype = vim.bo.filetype

  return {
    repo_root = root,
    selection = selection,
    extracted = extracted,
  }
end

return M
