local with_local_config = require 'utils.with_local_config'

vim.g.codecompanion_auto_tool_mode = true

return {
  {
    'Davidyz/VectorCode',
    lazy = true,
    version = '*', -- optional, depending on whether you're on nightly or release
    -- build = 'pipx upgrade vectorcode', -- optional but recommended. This keeps your CLI up-to-date.
    dependencies = { 'nvim-lua/plenary.nvim' },
  },
  {
    'olimorris/codecompanion.nvim',
    lazy = true,
    keys = {
      { '<leader>cc', '<cmd>CodeCompanionToggle<cr>', desc = 'CodeCompanion' },
    },
    dependencies = {
      'nvim-lua/plenary.nvim',
      'nvim-treesitter/nvim-treesitter',
      'ravitemer/mcphub.nvim',
      'ravitemer/codecompanion-history.nvim',
      { 'echasnovski/mini.nvim', version = '*' },
      'Davidyz/VectorCode',
      {
        'MeanderingProgrammer/render-markdown.nvim',
        opts = {
          file_types = { 'markdown', 'codecompanion' },
        },
        ft = { 'markdown' },
      },
    },
    config = function()
      require 'mcphub.extensions.codecompanion'
      require('codecompanion').setup(with_local_config('plugins.codecompanion-local', {
        log_level = 'ERROR',
        extensions = {
          mcphub = {
            callback = 'mcphub.extensions.codecompanion',
            opts = {
              show_result_in_chat = false, -- Show mcp tool results in chat
              make_vars = true, -- Convert resources to #variables
              make_slash_commands = true, -- Add prompts as /slash commands
            },
          },
          history = {
            enabled = true,
            opts = {
              keymap = 'gh',
              auto_generate_title = true, -- Automatically generate a title for the history entry
              continue_last_chat = false,
              delete_on_clearing_chat = false,
              picker = 'telescope',
              enable_logging = false,
              dir_to_save = vim.fn.stdpath 'data' .. '/codecompanion_history',
            },
          },
          vectorcode = {
            opts = {
              add_tool = true,
            },
          },
        },
        display = {
          chat = {
            window = {
              position = 'left',
              full_height = true, -- This ensures proper window positioning with splitright=true
              width = 0.4,
            },
            show_references = false, -- Show references (from slash commands and variables) in the chat buffer?
            show_settings = true,
          },
        },
        diff = {
          enabled = false,
        },
        strategies = {
          chat = {
            tools = {
              opts = {
                auto_submit_errors = true, -- Send any errors to the LLM automatically?
                auto_submit_success = true, -- Send any successful output to the LLM automatically?
              },
            },
          },
        },
        job_start_delay = 50, -- Delay in milliseconds between cmd tools
        submit_delay = 50, -- Delay in milliseconds before auto-submitting the chat buffer
      }))

      vim.keymap.set('n', '<leader>cc', '<cmd>CodeCompanionChat<cr>', { desc = 'Open CodeCompanion Chat' })
      vim.keymap.set('n', '<leader>ca', '<cmd>CodeCompanionActions<cr>', { desc = 'Open CodeCompanion Actions' })
      vim.keymap.set('v', '<leader>cp', '<cmd>CodeCompanionPrompt<cr>', { desc = 'Send selection to CodeCompanion' })
    end,
  },
}
