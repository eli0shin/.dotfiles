local M = {}

local poll_interval = 30000
local state

local function notify(message, level)
  vim.notify(message, level, { title = 'PR Diff' })
end

local function redraw_status()
  vim.cmd.redrawstatus()
end

local function stop_timer()
  if state and state.timer and not state.timer:is_closing() then
    state.timer:stop()
    state.timer:close()
    state.timer = nil
  end
end

local function command_error(result)
  local message = vim.trim((result.stderr or '') .. '\n' .. (result.stdout or ''))
  return message ~= '' and message or 'unknown error'
end

local function current_head(head_ref)
  local result = vim.system({ 'git', 'rev-parse', '--verify', head_ref }, { text = true }):wait()
  if result.code ~= 0 then
    return nil, command_error(result)
  end

  return vim.trim(result.stdout)
end

local function selected_file()
  local ok, lib = pcall(require, 'diffview.lib')
  if not ok then
    return nil
  end

  local view = lib.get_current_view()
  return view and view.panel and view.panel.cur_file and view.panel.cur_file.path or nil
end

local function open_diff(file)
  local args = { state.base_ref .. '...' .. state.head_ref }
  if file then
    table.insert(args, '--selected-file=' .. file)
  end

  vim.api.nvim_cmd({ cmd = 'DiffviewOpen', args = args }, {})
  state.tabpage = vim.api.nvim_get_current_tabpage()
end

local function read_config()
  local config = {
    number = vim.env.PR_DIFF_NUMBER,
    url = vim.env.PR_DIFF_URL,
    repo_url = vim.env.PR_DIFF_REPO_URL,
    base_branch = vim.env.PR_DIFF_BASE_BRANCH,
    base_ref = vim.env.PR_DIFF_BASE_REF,
    head_ref = vim.env.PR_DIFF_HEAD_REF,
  }

  for name, value in pairs(config) do
    if not value or value == '' then
      return nil, 'missing PR_DIFF_' .. name:upper()
    end
  end

  return config
end

local function check_head()
  local current = state
  if not current or current.checking or current.reloading then
    return
  end

  current.checking = true
  vim.system({
    'gh',
    'pr',
    'view',
    current.url,
    '--json',
    'headRefOid',
    '--jq',
    '.headRefOid',
  }, { text = true }, function(result)
    vim.schedule(function()
      if state ~= current then
        return
      end

      current.checking = false
      if result.code ~= 0 then
        return
      end

      local head = vim.trim(result.stdout or '')
      if head == '' then
        return
      end

      local was_outdated = current.outdated
      current.outdated = head ~= current.tracked_head
      if current.outdated ~= was_outdated then
        redraw_status()
      end

      if current.outdated and not was_outdated then
        notify('PR #' .. current.number .. ' has new commits. Run :PRDiffReload when ready.', vim.log.levels.WARN)
      end
    end)
  end)
end

local function start_timer()
  state.timer = vim.uv.new_timer()
  state.timer:start(poll_interval, poll_interval, vim.schedule_wrap(check_head))
end

function M.open()
  stop_timer()
  state = nil

  local config, config_error = read_config()
  if not config then
    notify(config_error, vim.log.levels.ERROR)
    return
  end

  local head, head_error = current_head(config.head_ref)
  if not head then
    notify('Cannot read the PR head: ' .. head_error, vim.log.levels.ERROR)
    return
  end

  state = config
  state.tracked_head = head
  state.outdated = false
  state.checking = false
  state.reloading = false
  state.reopening = false

  open_diff()
  start_timer()

  vim.api.nvim_create_user_command('PRDiffReload', M.reload, {
    desc = 'Reload the active PR Diffview',
    force = true,
  })

  local group = vim.api.nvim_create_augroup('pr-diff-watch', { clear = true })
  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = M.stop,
  })
  vim.api.nvim_create_autocmd('User', {
    group = group,
    pattern = 'DiffviewViewClosed',
    callback = function()
      if state and not state.reopening and not vim.api.nvim_tabpage_is_valid(state.tabpage) then
        M.stop()
        redraw_status()
      end
    end,
  })
end

function M.reload()
  local current = state
  if not current then
    notify('No PR Diffview is active.', vim.log.levels.WARN)
    return
  end
  if current.reloading then
    return
  end
  if current.tabpage ~= vim.api.nvim_get_current_tabpage() then
    notify('Open the PR Diffview tab before reloading.', vim.log.levels.WARN)
    return
  end

  current.reloading = true
  vim.system({
    'git',
    'fetch',
    '--quiet',
    current.repo_url,
    '+refs/heads/' .. current.base_branch .. ':' .. current.base_ref,
    '+refs/pull/' .. current.number .. '/head:' .. current.head_ref,
  }, { text = true }, function(fetch_result)
    vim.schedule(function()
      if state ~= current then
        return
      end
      if fetch_result.code ~= 0 then
        current.reloading = false
        notify('Cannot fetch PR #' .. current.number .. ': ' .. command_error(fetch_result), vim.log.levels.ERROR)
        return
      end

      local head, head_error = current_head(current.head_ref)
      if not head then
        current.reloading = false
        notify('Cannot read the updated PR head: ' .. head_error, vim.log.levels.ERROR)
        return
      end
      if current.tabpage ~= vim.api.nvim_get_current_tabpage() then
        current.reloading = false
        notify('PR updated. Return to its Diffview tab and reload again.', vim.log.levels.WARN)
        return
      end

      local file = selected_file()
      current.reopening = true
      local ok, reload_error = pcall(function()
        vim.api.nvim_cmd({ cmd = 'DiffviewClose' }, {})
        open_diff(file)
      end)
      current.reopening = false
      current.reloading = false
      if not ok then
        notify('Cannot reload PR #' .. current.number .. ': ' .. reload_error, vim.log.levels.ERROR)
        M.stop()
        redraw_status()
        return
      end

      current.tracked_head = head
      current.outdated = false
      redraw_status()
      notify('Reloaded PR #' .. current.number, vim.log.levels.INFO)
    end)
  end)
end

function M.status()
  if not state or not state.outdated then
    return ''
  end

  return 'PR #' .. state.number .. ' OUTDATED'
end

function M.stop()
  stop_timer()
  state = nil
end

return M
