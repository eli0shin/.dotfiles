local M = {}

local defaults = {
  provider = 'opencode',
  keymaps = {
    add = '<leader>dca',
    list = '<leader>dcl',
    run = '<leader>dcr',
    clear = '<leader>dcx',
  },
  max_selection_lines = 200,
  storage_path = vim.fn.stdpath('data') .. '/diff-review-comments/comments.json',
  notify = true,
  terminal = {
    height = 15,
  },
  providers = {
    opencode = {
      provider_id = 'openai',
      model_id = 'gpt-5.3-codex',
      template = 'opencode --model {provider_id}/{model_id} --prompt {prompt_text}',
    },
    claude = {
      template = 'claude < {prompt_file}',
    },
    custom = {
      template = '',
    },
  },
}

function M.build(user)
  return vim.tbl_deep_extend('force', defaults, user or {})
end

return M
