local M = {}

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

  vim.cmd 'enew'

  local job_id = vim.fn.termopen(cmd, {
    cwd = opts.cwd,
  })

  if job_id <= 0 then
    vim.notify('Failed to open terminal for provider command', vim.log.levels.ERROR)
    return
  end

  vim.cmd.startinsert()
end

return M
