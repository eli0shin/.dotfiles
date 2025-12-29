-- [[ Basic Autocommands ]]
--  See `:help lua-guide-autocommands`

-- Highlight when yanking (copying) text
--  Try it with `yap` in normal mode
--  See `:help vim.highlight.on_yank()`
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('kickstart-highlight-yank', { clear = true }),
  callback = function()
    vim.highlight.on_yank()
  end,
})

-- Configure terminal environment for proper color support
vim.api.nvim_create_autocmd('TermOpen', {
  desc = 'Set terminal environment variables for color support',
  group = vim.api.nvim_create_augroup('terminal-env', { clear = true }),
  callback = function()
    -- Set environment variables for proper color support in nested terminals
    vim.fn.setenv('COLORTERM', 'truecolor')
    -- Preserve the original TERM if it supports colors
    local current_term = vim.env.TERM
    if current_term and (current_term:match('256color') or current_term:match('xterm')) then
      vim.fn.setenv('TERM', current_term)
    end
  end,
})

vim.api.nvim_create_user_command('Browse', function(opts)
  vim.fn.system { 'open', opts.fargs[1] }
end, { nargs = 1 })

-- Add :Rebase branch_name command
vim.api.nvim_create_user_command('Rebase', function(opts)
  local branch = opts.args
  if branch == '' then
    print 'Error: Please provide a branch name. Usage: :Rebase <branch>'
    return
  end

  local function run_git_command(cmd)
    local handle = io.popen(cmd)
    if handle then
      local result = handle:read '*a'
      handle:close()
      print(result)
    else
      print('Error running command: ' .. cmd)
    end
  end

  run_git_command('git checkout ' .. branch)
  run_git_command 'git pull'
  run_git_command 'git checkout -'
  run_git_command('git rebase ' .. branch)
end, {
  nargs = 1, -- Require exactly one argument (branch name)
  complete = function()
    -- Autocomplete branch names
    local branches = {}
    local handle = io.popen "git branch --format='%(refname:short)' 2>/dev/null"
    if handle then
      for line in handle:lines() do
        table.insert(branches, line)
      end
      handle:close()
    end
    return branches
  end,
})
