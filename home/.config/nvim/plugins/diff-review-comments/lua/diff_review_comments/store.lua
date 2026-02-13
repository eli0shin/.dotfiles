local M = {}

local function dirname(path)
  return vim.fn.fnamemodify(path, ':h')
end

local function iso_now()
  return os.date('!%Y-%m-%dT%H:%M:%SZ')
end

local function ensure_dir(path)
  vim.fn.mkdir(dirname(path), 'p')
end

local function empty_data()
  return {
    schema_version = 1,
    repos = {},
  }
end

local function read_file(path)
  if vim.fn.filereadable(path) == 0 then
    return nil
  end

  local lines = vim.fn.readfile(path)
  return table.concat(lines, '\n')
end

local function write_atomic(path, content)
  ensure_dir(path)
  local tmp = path .. '.tmp.' .. vim.fn.getpid()
  vim.fn.writefile(vim.split(content, '\n', { plain = true }), tmp)
  vim.uv.fs_rename(tmp, path)
end

local function load_data(path)
  local raw = read_file(path)
  if not raw or raw == '' then
    return empty_data()
  end

  local ok, decoded = pcall(vim.json.decode, raw)
  if ok and type(decoded) == 'table' then
    decoded.repos = decoded.repos or {}
    decoded.schema_version = decoded.schema_version or 1
    return decoded
  end

  local backup_path = path .. '.bak.' .. os.date('%Y%m%d%H%M%S')
  pcall(vim.uv.fs_rename, path, backup_path)
  return empty_data()
end

local function save_data(path, data)
  local encoded = vim.json.encode(data)
  write_atomic(path, encoded)
end

function M.load_repo(path, repo_root)
  local data = load_data(path)
  data.repos[repo_root] = data.repos[repo_root] or {
    updated_at = iso_now(),
    comments = {},
    last_run = nil,
  }
  return data, data.repos[repo_root]
end

function M.add_comment(path, repo_root, comment)
  local data, repo = M.load_repo(path, repo_root)
  table.insert(repo.comments, comment)
  repo.updated_at = iso_now()
  save_data(path, data)
  return comment
end

function M.update_comment_text(path, repo_root, id, text)
  local data, repo = M.load_repo(path, repo_root)
  for _, c in ipairs(repo.comments) do
    if c.id == id then
      c.comment_text = text
      repo.updated_at = iso_now()
      save_data(path, data)
      return true
    end
  end
  return false
end

function M.delete_comment(path, repo_root, id)
  local data, repo = M.load_repo(path, repo_root)
  local next_comments = {}
  local deleted = false
  for _, c in ipairs(repo.comments) do
    if c.id == id then
      deleted = true
    else
      table.insert(next_comments, c)
    end
  end
  if deleted then
    repo.comments = next_comments
    repo.updated_at = iso_now()
    save_data(path, data)
  end
  return deleted
end

function M.clear_repo(path, repo_root)
  local data, repo = M.load_repo(path, repo_root)
  repo.comments = {}
  repo.updated_at = iso_now()
  save_data(path, data)
end

function M.get_open_comments(path, repo_root)
  local _, repo = M.load_repo(path, repo_root)
  local out = {}
  for _, c in ipairs(repo.comments) do
    if c.status == 'open' or c.status == nil then
      table.insert(out, c)
    end
  end
  return out
end

function M.set_last_run(path, repo_root, value)
  local data, repo = M.load_repo(path, repo_root)
  repo.last_run = value
  repo.updated_at = iso_now()
  save_data(path, data)
end

return M
