local M = {}

local config_mod = require 'diff_review_comments.config'
local context = require 'diff_review_comments.context'
local store = require 'diff_review_comments.store'
local utils = require 'diff_review_comments.utils'
local input_float = require 'diff_review_comments.ui.input_float'
local list_ui = require 'diff_review_comments.ui.list'
local prompt = require 'diff_review_comments.prompt'
local terminal = require 'diff_review_comments.terminal'

local state = {
  config = nil,
}

local function notify(msg, level)
  if state.config and state.config.notify then
    vim.notify(msg, level or vim.log.levels.INFO)
  end
end

local function make_comment(captured, text)
  local extracted = captured.extracted
  local nonce = tostring(vim.uv.hrtime()):gsub('%D', ''):sub(-8)
  if nonce == '' then
    nonce = tostring(math.random(10000000, 99999999))
  end
  return {
    id = string.format('cmt_%s_%s', os.date('%Y%m%d%H%M%S'), nonce),
    created_at = os.date('!%Y-%m-%dT%H:%M:%SZ'),
    status = 'open',
    source = extracted.source,
    file = {
      repo_relpath = extracted.file.repo_relpath,
      abs_path = extracted.file.abs_path,
      filetype = extracted.file.filetype,
    },
    selection = captured.selection,
    diff = extracted.diff,
    comment_text = text,
  }
end

function M.add_from_visual()
  local captured, err = context.capture(state.config.max_selection_lines)
  if not captured then
    notify(err, vim.log.levels.WARN)
    return
  end

  local target = captured.extracted.file.repo_relpath or captured.extracted.file.abs_path or '[no file]'
  local side = utils.side_info(captured.extracted.diff.selected_side)

  input_float.open {
    title = string.format('Comment %s (%s)', target, side.label),
    on_submit = function(text)
      local comment = make_comment(captured, text)
      store.add_comment(state.config.storage_path, captured.repo_root, comment)
      notify(string.format('Saved %s diff review comment %s', side.label, comment.id))
    end,
  }
end

function M.add_from_motion()
  local start_mark = vim.api.nvim_buf_get_mark(0, '[')
  local end_mark = vim.api.nvim_buf_get_mark(0, ']')
  if start_mark[1] == 0 or end_mark[1] == 0 then
    notify('No motion range found', vim.log.levels.WARN)
    return
  end

  vim.fn.setpos("'<", { 0, start_mark[1], start_mark[2] + 1, 0 })
  vim.fn.setpos("'>", { 0, end_mark[1], end_mark[2] + 1, 0 })
  M.add_from_visual()
end

function M.operator_add()
  M.add_from_motion()
end

function M.start_motion_add()
  vim.go.operatorfunc = "v:lua.require'diff_review_comments'.operator_add"
  return 'g@'
end

function M.list_comments()
  local repo_root = context.current_repo_root()

  list_ui.open {
    repo_root = repo_root,
    get_comments = function()
      return store.get_open_comments(state.config.storage_path, repo_root)
    end,
    delete_comment = function(comment)
      local deleted = store.delete_comment(state.config.storage_path, repo_root, comment.id)
      if deleted then
        local side = utils.side_info(comment.diff.selected_side)
        notify(string.format('Deleted %s comment %s', side.label, comment.id))
      end
    end,
    update_comment = function(comment, text)
      local ok = store.update_comment_text(state.config.storage_path, repo_root, comment.id, text)
      if ok then
        local side = utils.side_info(comment.diff.selected_side)
        notify(string.format('Updated %s comment %s', side.label, comment.id))
      end
    end,
    clear_all = function()
      store.clear_repo(state.config.storage_path, repo_root)
      notify('Cleared all comments for repo')
    end,
  }
end

function M.clear_comments()
  local repo_root = context.current_repo_root()
  local answer = vim.fn.confirm('Clear all diff review comments for this repo?', '&Yes\n&No', 2)
  if answer ~= 1 then
    return
  end
  store.clear_repo(state.config.storage_path, repo_root)
  notify('Cleared all comments for repo')
end

function M.run_comments()
  local repo_root = context.current_repo_root()
  local comments = store.get_open_comments(state.config.storage_path, repo_root)
  if #comments == 0 then
    notify('No open comments to run', vim.log.levels.WARN)
    return
  end

  local prompt_text = prompt.build(repo_root, comments)
  local prompt_file = prompt.write_snapshot(prompt_text)

  local provider_name = state.config.provider
  local provider = state.config.providers[provider_name]
  if not provider or provider.template == '' then
    notify('Provider template is not configured for ' .. provider_name, vim.log.levels.ERROR)
    return
  end

  terminal.run {
    template = provider.template,
    provider_id = provider.provider_id,
    model_id = provider.model_id,
    prompt_file = prompt_file,
    cwd = repo_root,
    comment_count = #comments,
    height = state.config.terminal.height,
  }

  store.set_last_run(state.config.storage_path, repo_root, {
    at = os.date('!%Y-%m-%dT%H:%M:%SZ'),
    provider = provider_name,
    comment_ids = vim.tbl_map(function(c)
      return c.id
    end, comments),
    prompt_file = prompt_file,
  })

  notify('Running review prompt with ' .. provider_name)
end

local function set_keymaps()
  local keymaps = state.config.keymaps
  vim.keymap.set('x', keymaps.add, function()
    M.add_from_visual()
  end, { desc = 'Diff comments: add from selection' })
  vim.keymap.set('n', keymaps.add, function()
    return M.start_motion_add()
  end, { expr = true, desc = 'Diff comments: add from motion' })
  vim.keymap.set('n', keymaps.list, function()
    M.list_comments()
  end, { desc = 'Diff comments: list/edit' })
  vim.keymap.set('n', keymaps.run, function()
    M.run_comments()
  end, { desc = 'Diff comments: run prompt' })
  vim.keymap.set('n', keymaps.clear, function()
    M.clear_comments()
  end, { desc = 'Diff comments: clear' })
end

local function set_commands()
  vim.api.nvim_create_user_command('DiffReviewCommentAdd', function()
    M.add_from_visual()
  end, { force = true })
  vim.api.nvim_create_user_command('DiffReviewCommentList', function()
    M.list_comments()
  end, { force = true })
  vim.api.nvim_create_user_command('DiffReviewCommentRun', function()
    M.run_comments()
  end, { force = true })
  vim.api.nvim_create_user_command('DiffReviewCommentClear', function()
    M.clear_comments()
  end, { force = true })
end

function M.setup(user_config)
  state.config = config_mod.build(user_config)
  set_commands()
  set_keymaps()
end

return M
