-- Keeps a plain-text Review comments file in sync with the open comments so
-- agents can read them:
--   PR review (pr_diff):     /tmp/review/<org>/<repo>/<pr-number>.txt
--   origin and a branch:     /tmp/review/current/<org>/<repo>/<branch>.txt
--   anything else:           /tmp/review/local/<root>.txt
-- <root> is the comments' directory (the git top level, or Neovim's working
-- directory outside git) without its leading slash, so a repository with no
-- origin remote, a detached HEAD, or a plain directory still gets a file.
local M = {}

local prompt = require 'diff_review_comments.prompt'
local utils = require 'diff_review_comments.utils'

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
  local pr = utils.current_pr()
  if pr then
    return string.format('%s/%s/%s.txt', root_dir, pr.slug, pr.number)
  end

  local slug = github_slug(git(repo_root, { 'remote', 'get-url', 'origin' }))
  local branch = git(repo_root, { 'branch', '--show-current' })
  if slug and branch then
    return string.format('%s/current/%s/%s.txt', root_dir, slug, branch)
  end

  local root = vim.fs.normalize(repo_root):gsub('/+$', ''):gsub('^/+', '')
  if root == '' then
    return nil
  end
  return string.format('%s/local/%s.txt', root_dir, root)
end

-- Rewrites the file from `comments`; removes it when there are none.
-- Returns nil when no path can be resolved (the filesystem root).
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
