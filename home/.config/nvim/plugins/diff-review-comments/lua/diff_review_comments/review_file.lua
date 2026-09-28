-- Keeps a plain-text Review comments file in sync with the open comments so
-- agents can read them:
--   PR review (pr_diff):  /tmp/review/<org>/<repo>/<pr-number>.txt
--   anything else:        /tmp/review/current/<org>/<repo>/<branch>.txt
local M = {}

local prompt = require 'diff_review_comments.prompt'

local root_dir = '/tmp/review'

local function git(repo_root, args)
  local cmd = vim.list_extend({ 'git', '-C', repo_root }, args)
  local result = vim.system(cmd, { text = true }):wait()
  if result.code ~= 0 then
    return nil
  end
  local out = vim.trim(result.stdout or '')
  return out ~= '' and out or nil
end

local function github_slug(url)
  if not url then
    return nil
  end
  url = url:gsub('%.git$', ''):gsub('/$', '')
  return url:match '[:/]([^/:]+/[^/]+)$'
end

function M.path(repo_root)
  local pr_url = vim.env.PR_DIFF_URL
  if pr_url and pr_url ~= '' then
    local slug, number = pr_url:match 'github%.com/([^/]+/[^/]+)/pull/(%d+)'
    if slug then
      return string.format('%s/%s/%s.txt', root_dir, slug, number)
    end
  end

  local slug = github_slug(git(repo_root, { 'remote', 'get-url', 'origin' }))
  local branch = git(repo_root, { 'branch', '--show-current' })
  if not slug or not branch then
    return nil
  end
  return string.format('%s/current/%s/%s.txt', root_dir, slug, branch)
end

-- Rewrites the file from `comments`; removes it when there are none.
-- Returns nil when no path can be resolved (no origin remote or detached HEAD).
function M.sync(repo_root, comments)
  local path = M.path(repo_root)
  if not path then
    return nil
  end

  if #comments == 0 then
    os.remove(path)
    return path
  end

  vim.fn.mkdir(vim.fn.fnamemodify(path, ':h'), 'p')
  local tmp = path .. '.tmp.' .. vim.fn.getpid()
  vim.fn.writefile(vim.split(prompt.build(repo_root, comments), '\n', { plain = true }), tmp)
  vim.uv.fs_rename(tmp, path)
  return path
end

return M
