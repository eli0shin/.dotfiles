local M = {}

local state = {
  term_bufnr = nil,
  term_winid = nil,
  shell_job_id = nil,
  cwd = nil,
}

local function expand(template, vars)
  local out = template
  out = out:gsub('{prompt_file}', function() return vars.prompt_file end)
  out = out:gsub('{prompt_text}', function() return vars.prompt_text end)
  out = out:gsub('{provider_id}', function() return vars.provider_id end)
  out = out:gsub('{model_id}', function() return vars.model_id end)
  out = out:gsub('{cwd}', function() return vars.cwd end)
  out = out:gsub('{comment_count}', function() return tostring(vars.comment_count) end)
  return out
end

function M.run(opts)
  local prompt_text = table.concat(vim.fn.readfile(opts.prompt_file), '\n')
  local cmd = expand(opts.template, {
    prompt_file = vim.fn.shellescape(opts.prompt_file),
    prompt_text = vim.fn.shellescape(prompt_text),
    provider_id = opts.provider_id or '',
    model_id = opts.model_id or '',
    cwd = vim.fn.shellescape(opts.cwd),
    comment_count = opts.comment_count,
  })

  local function valid_buf(bufnr)
    return bufnr and vim.api.nvim_buf_is_valid(bufnr)
  end

  local function valid_win(winid)
    return winid and vim.api.nvim_win_is_valid(winid)
  end

  local function ensure_terminal_buffer(cwd)
    if valid_buf(state.term_bufnr) then
      return state.term_bufnr
    end

    local bufnr = vim.api.nvim_create_buf(true, false)
    local name = string.format('diff-review-comments://terminal/%s', cwd)
    pcall(vim.api.nvim_buf_set_name, bufnr, name)

    vim.bo[bufnr].bufhidden = 'hide'
    vim.bo[bufnr].swapfile = false
    vim.bo[bufnr].filetype = 'diff-review-comments-terminal'

    state.term_bufnr = bufnr
    return bufnr
  end

  local function ensure_terminal_window(bufnr)
    if valid_win(state.term_winid) then
      vim.api.nvim_set_current_win(state.term_winid)
      if vim.api.nvim_win_get_buf(state.term_winid) ~= bufnr then
        vim.api.nvim_win_set_buf(state.term_winid, bufnr)
      end
      return state.term_winid
    end

    local winid = vim.api.nvim_get_current_win()
    vim.api.nvim_win_set_buf(winid, bufnr)
    state.term_winid = winid
    return winid
  end

  local function job_running(job_id)
    if not job_id or job_id <= 0 then
      return false
    end
    return vim.fn.jobwait({ job_id }, 0)[1] == -1
  end

  local function ensure_shell_job(bufnr, cwd)
    if job_running(state.shell_job_id) and state.cwd == cwd then
      return state.shell_job_id
    end

    local shell = vim.o.shell
    local job_id = nil
    vim.api.nvim_buf_call(bufnr, function()
      job_id = vim.fn.termopen(shell, { cwd = cwd })
    end)

    if not job_id or job_id <= 0 then
      return nil
    end

    state.shell_job_id = job_id
    state.cwd = cwd
    return job_id
  end

  local bufnr = ensure_terminal_buffer(opts.cwd)
  ensure_terminal_window(bufnr)

  local shell_job_id = ensure_shell_job(bufnr, opts.cwd)
  if not shell_job_id then
    vim.notify('Failed to open terminal for provider command', vim.log.levels.ERROR)
    return
  end

  vim.fn.chansend(shell_job_id, cmd .. '\n')
  vim.cmd.startinsert()
end

return M
