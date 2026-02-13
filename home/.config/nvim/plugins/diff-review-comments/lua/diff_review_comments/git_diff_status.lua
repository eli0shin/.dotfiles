local M = {}

local function parse_count(value)
  if value == nil or value == '' then
    return 1
  end
  return tonumber(value) or 0
end

local function add_range(set, start_line, count)
  if not start_line or not count or count <= 0 then
    return
  end

  local finish = start_line + count - 1
  for line_no = start_line, finish do
    set[line_no] = true
  end
end

local function parse_hunk_header(line)
  local old_start, old_count, new_start, new_count = line:match('^@@ %-(%d+),?(%d*) %+(%d+),?(%d*) @@')
  if not old_start or not new_start then
    return nil
  end

  return {
    old_start = tonumber(old_start),
    old_count = parse_count(old_count),
    new_start = tonumber(new_start),
    new_count = parse_count(new_count),
  }
end

local function run_git(cmd)
  local out = vim.fn.systemlist(cmd)
  if vim.v.shell_error ~= 0 then
    return nil
  end
  return out
end

local function append_lines(into, lines)
  if not lines then
    return
  end
  for _, line in ipairs(lines) do
    table.insert(into, line)
  end
end

local function first_line(lines)
  if not lines or #lines == 0 then
    return nil
  end
  local value = lines[1]
  if value == nil or value == '' then
    return nil
  end
  return value
end

local function resolve_merge_base(repo_root)
  local root = vim.fn.shellescape(repo_root)
  local candidates = {
    string.format('git -C %s merge-base HEAD @{upstream}', root),
    string.format('git -C %s merge-base HEAD origin/HEAD', root),
    string.format('git -C %s merge-base HEAD origin/main', root),
    string.format('git -C %s merge-base HEAD origin/master', root),
  }

  for _, cmd in ipairs(candidates) do
    local resolved = first_line(run_git(cmd))
    if resolved then
      return resolved
    end
  end

  return nil
end

local function normalized_compare(compare)
  if type(compare) ~= 'table' then
    return nil, nil
  end

  local base = compare.base or compare.left
  local head = compare.head or compare.right
  if base == '' then
    base = nil
  end
  if head == '' then
    head = nil
  end

  return base, head
end

local function run_git_diff(repo_root, repo_relpath, compare)
  if repo_root == nil or repo_root == '' or repo_relpath == nil or repo_relpath == '' then
    return nil
  end
  if vim.fn.executable('git') ~= 1 then
    return nil
  end

  local root = vim.fn.shellescape(repo_root)
  local path = vim.fn.shellescape(repo_relpath)
  local base, head = normalized_compare(compare)

  if base and head then
    local cmd = string.format('git -C %s diff --no-color -U0 %s %s -- %s', root, vim.fn.shellescape(base), vim.fn.shellescape(head), path)
    local out = run_git(cmd)
    if out then
      return out
    end
  end

  local out = {}
  local merge_base = base or resolve_merge_base(repo_root)
  if merge_base then
    local branch_cmd = string.format('git -C %s diff --no-color -U0 %s...HEAD -- %s', root, vim.fn.shellescape(merge_base), path)
    append_lines(out, run_git(branch_cmd))
  end

  local working_tree_cmd = string.format('git -C %s diff --no-color -U0 HEAD -- %s', root, path)
  append_lines(out, run_git(working_tree_cmd))

  if #out == 0 then
    return nil
  end

  return out
end

function M.get_changed_lines(repo_root, repo_relpath, compare)
  local changed = {
    from = {},
    to = {},
  }

  local lines = run_git_diff(repo_root, repo_relpath, compare)
  if not lines then
    return changed
  end

  for _, line in ipairs(lines) do
    local hunk = parse_hunk_header(line)
    if hunk then
      add_range(changed.from, hunk.old_start, hunk.old_count)
      add_range(changed.to, hunk.new_start, hunk.new_count)
    end
  end

  return changed
end

return M
