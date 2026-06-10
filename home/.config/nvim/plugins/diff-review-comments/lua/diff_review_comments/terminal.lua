local M = {}

local state = {
  term_winid = nil,
}

local function expand(template, vars)
  local out = template
  out = out:gsub('{prompt_file}', function() return vars.prompt_file end)
  out = out:gsub('{prompt_text}', function() return vars.prompt_text end)
  out = out:gsub('{provider_id}', function() return vars.provider_id end)
  out = out:gsub('{model_id}', function() return vars.model_id end)
  out = out:gsub('{agent_id}', function() return vars.agent_id end)
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
    agent_id = opts.agent_id or '',
    cwd = vim.fn.shellescape(opts.cwd),
    comment_count = opts.comment_count,
  })

  local function valid_win(winid)
    return winid and vim.api.nvim_win_is_valid(winid)
  end

  local function create_terminal_buffer(cwd)
    local bufnr = vim.api.nvim_create_buf(true, false)
    local name = string.format('diff-review-comments://terminal/%s/%s', vim.fn.fnamemodify(cwd, ':t'), vim.uv.hrtime())
    pcall(vim.api.nvim_buf_set_name, bufnr, name)

    vim.bo[bufnr].bufhidden = 'hide'
    vim.bo[bufnr].swapfile = false
    vim.bo[bufnr].filetype = 'diff-review-comments-terminal'

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

  local bufnr = create_terminal_buffer(opts.cwd)
  ensure_terminal_window(bufnr)

  local job_id = nil
  vim.api.nvim_buf_call(bufnr, function()
    job_id = vim.fn.termopen(cmd, { cwd = opts.cwd })
  end)

  if not job_id or job_id <= 0 then
    vim.notify('Failed to open terminal for provider command', vim.log.levels.ERROR)
    return
  end

  vim.cmd.startinsert()
end

return M
