local with_local_config = require 'utils.with_local_config'

package.cpath = vim.fn.stdpath 'data' .. '/avante/?.so;' .. package.cpath

-- Some prompt lines that I'm not using right now:
-- If you think running multiple tools can answer the user's question, prefer calling them in parallel whenever possible.
-- Don't run terminal commands multiple times in parallel. Instead, run one command and wait for the output before running the next command.
-- NEVER say the name of a tool to a user. For example, instead of saying that you'll use the run_in_terminal tool, say "I'll run the command in a terminal".

local system_prompt =
  [[ You are a highly sophisticated automated coding agent with expert-level knowledge across many different programming languages and frameworks.

The user will ask a question, or ask you to perform a task, and it may require lots of research to answer correctly.
There is a selection of tools that let you perform actions or retrieve helpful context to answer the user's question.

You will be given some context and attachments along with the user prompt. You can use them if they are relevant to the task, and ignore them if not.
If you can infer the project type (languages, frameworks, and libraries) from the user's query or the context that you have, make sure to keep them in mind when making changes.

If the user wants you to implement a feature and they have not specified the files to edit, first break down the user's request into smaller concepts and think about the kinds of files you need to grasp each concept.

Think step by step

If you aren't sure which tool is relevant, you can call multiple tools.

You MUST call tools repeatedly to take actions or gather as much context as needed until you have completed the task fully. Don't give up unless you are sure the request cannot be fulfilled with the tools you have.

It's YOUR RESPONSIBILITY to make sure that you have done all you can to collect necessary context.

If you say that you will take an action, then go ahead and use the tool to do it. Do not ask permission.

Don't make assumptions about the situation - gather context first, then perform the task or answer the question.

Don't repeat yourself after a tool call, pick up where you left off.

NEVER print out a codeblock with file changes unless the user asked for it.

When using a tool, follow the json schema very carefully and make sure to include ALL required properties.
Always output valid JSON when using a tool.

If a tool exists to do a task, use the tool instead of asking the user to manually take an action.

When invoking a tool that takes a file path, always use the absolute file path. If the file has a scheme like untitled: or vscode-userdata:, then use a URI with the scheme.

NEVER show the changes to the user, just call the tool, and the edits will be applied and shown to the user.

Don't try to edit an existing file without reading it first, so you can make changes properly.
NEVER show the changes to the user, just call the tool, and the edits will be applied and shown to the user.

After editing a file, use the get_diagnostics tool to check if there are any errors.
Fix the errors if they are relevant to your change or the prompt, and if you can figure out how to fix them, and remember to validate that they were actually fixed. Do not loop more than 3 times attempting to fix errors in the same file. If the third try fails, you should stop and ask the user what to do next.

When calling a tools from an mcp server, make sure to use the mcp tool and pass the server and tool names as a parameter.
  ]]

---@class avante.Config
return {
  'eli0shin/avante.nvim',
  branch = 'auto_tool_mode',
  -- dir = '/Users/elioshinsky/code/avante.nvim',
  name = 'avante.nvim',
  lazy = true,
  keys = {
    { '<leader>aa', '<cmd>AvanteAsk<cr>', desc = 'Avante' },
  },
  enabled = function()
    return vim.g.vscode == nil
  end,
  build = 'make',
  dependencies = {
    'nvim-treesitter/nvim-treesitter',
    'stevearc/dressing.nvim',
    'nvim-lua/plenary.nvim',
    'MunifTanjim/nui.nvim',
    'nvim-telescope/telescope.nvim',
    'nvim-tree/nvim-web-devicons',
    'zbirenbaum/copilot.lua',
    'ravitemer/mcphub.nvim',
    {
      -- support for image pasting
      'HakonHarnes/img-clip.nvim',
      event = 'VeryLazy',
      opts = {
        default = {
          embed_image_as_base64 = false,
          prompt_for_file_name = false,
          drag_and_drop = {
            insert_mode = true,
          },
        },
      },
    },
    {
      'MeanderingProgrammer/render-markdown.nvim',
      opts = {
        file_types = { 'markdown', 'Avante', 'codecompanion' },
      },
      ft = { 'markdown', 'Avante', 'codecompanion' },
    },
  },
  config = function()
    require('avante').setup(with_local_config('plugins.avante-local', {
      windows = {
        position = 'left',
        width = 40,
        ask = {
          floating = false,
          start_insert = false,
        },
      },
      diff = {
        autojump = false,
      },
      hints = { enabled = false },
      mappings = {
        --- @class AvanteConflictMappings
        diff = {
          ours = 'co',
          theirs = 'ct',
          all_theirs = 'ca',
          both = 'cb',
          cursor = 'cc',
          next = ']x',
          prev = '[x',
        },
        suggestion = {
          accept = '<C-y>',
          next = '<C-n>',
          prev = '<C-p>',
          dismiss = '<C-x>',
        },
        jump = {
          next = ']]',
          prev = '[[',
        },
        submit = {
          normal = '<CR>',
          insert = '<C-s>',
        },
        cancel = {
          normal = { '<C-c>' },
          insert = { '<C-c>' },
        },
        sidebar = {
          apply_all = 'A',
          apply_cursor = 'a',
          retry_user_request = 'r',
          edit_user_request = 'e',
          switch_windows = '<Tab>',
          reverse_switch_windows = '<S-Tab>',
          remove_file = 'd',
          add_file = '@',
          close = { '<C-x>' },
          close_from_input = { normal = '<C-x>', insert = '<C-x>' },
        },
      },
      behaviour = {
        auto_suggestions = false, -- Experimental stage
        auto_set_keymaps = true,
        support_paste_from_clipboard = true,
        jump_result_buffer_on_finish = false,
        minimize_diff = true,
        enable_token_counting = true,
        auto_approve_tool_permissions = true,
      },
      history = {
        max_tokens = 40000,
      },
      -- other config
      -- The system_prompt type supports both a string and a function that returns a string. Using a function here allows dynamically updating the prompt with mcphub
      system_prompt = function()
        local hub = require('mcphub').get_hub_instance()

        if not hub then
          return system_prompt
        end

        return system_prompt .. hub:get_active_servers_prompt()
      end,
      -- The custom_tools type supports both a list and a function that returns a list. Using a function here prevents requiring mcphub before it's loaded
      custom_tools = function()
        return {
          require('mcphub.extensions.avante').mcp_tool(),
        }
      end,
      web_search_engine = {
        provider = 'brave',
        proxy = nil,
      },
      -- Prefer the mcphub neovim tools which handle permissions and focus movement better
      disabled_tools = {
        'write_to_file',
        'replace_in_file',
        'insert',
        'rename_file',
        'delete_file',
        'create_dir',
        'rename_dir',
        'delete_dir',
      },
    }))
  end,
}
