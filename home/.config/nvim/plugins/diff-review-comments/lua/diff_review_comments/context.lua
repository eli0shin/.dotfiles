local M = {}

local diffview = require 'diff_review_comments.extractors.diffview'
local octo = require 'diff_review_comments.extractors.octo'
local generic = require 'diff_review_comments.extractors.generic'

local function run_git(repo, args)
  if vim.fn.executable 'git' ~= 1 then
    return nil
  end

  local cmd = string.format('git -C %s %s', vim.fn.shellescape(repo), args)
  local out = vim.fn.systemlist(cmd)
  if vim.v.shell_error ~= 0 or not out or #out == 0 then
    return nil
  end

  local line = out[1]
  if not line or line == '' then
    return nil
  end

  return line
end

local function resolve_merge_base(repo)
  local candidates = {
    'merge-base HEAD @{upstream}',
    'merge-base HEAD origin/HEAD',
    'merge-base HEAD origin/main',
    'merge-base HEAD origin/master',
  }

  for _, args in ipairs(candidates) do
    local value = run_git(repo, args)
    if value then
      return value
    end
  end

  return nil
end

local function resolve_base_branch(repo)
  return run_git(repo, 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}')
    or run_git(repo, 'symbolic-ref refs/remotes/origin/HEAD --short')
    or run_git(repo, 'rev-parse --abbrev-ref origin/main')
    or run_git(repo, 'rev-parse --abbrev-ref origin/master')
end

local function normalize_compare(repo, compare)
  local current = type(compare) == 'table' and compare or {}
  local normalized = {
    base = current.base or current.left,
    head = current.head or current.right,
    base_branch = current.base_branch or current.left_branch,
    head_branch = current.head_branch or current.right_branch,
  }

  if not normalized.head or normalized.head == '' then
    normalized.head = run_git(repo, 'rev-parse HEAD')
  end

  if not normalized.base or normalized.base == '' then
    normalized.base = resolve_merge_base(repo)
  end

  if not normalized.head_branch or normalized.head_branch == '' then
    normalized.head_branch = run_git(repo, 'branch --show-current') or 'HEAD'
  end

  if not normalized.base_branch or normalized.base_branch == '' then
    normalized.base_branch = resolve_base_branch(repo)
  end

  return normalized
end

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
  extracted.diff = extracted.diff or {}
  extracted.diff.compare = normalize_compare(root, extracted.diff.compare)

  return {
    repo_root = root,
    selection = selection,
    extracted = extracted,
  }
end

return M
