return {
  'saghen/blink.compat',
  lazy = true,
  dependencies = {
    'saghen/blink.cmp',
  },
  config = function()
    local ok, compat = pcall(require, 'blink.compat')
    if ok and type(compat.setup) == 'function' then
      -- Setup blink.compat with specific configuration for CodeCompanion
      compat.setup {
        -- Enable for specific filetypes
        filetypes = {
          codecompanion = true,
          markdown = true,
        },
      }

      -- Initialize any nvim-cmp source registrations needed
      if type(compat.register_source) == 'function' then
        -- Register sources needed by CodeCompanion with optimized settings
        compat.register_source('buffer', {
          priority = 500,
          get_trigger_characters = function()
            return {}
          end, -- Don't wait for trigger chars
          is_available = function()
            return true
          end, -- Always available
        })
        compat.register_source('path', {
          priority = 400,
          get_trigger_characters = function()
            return {}
          end,
          is_available = function()
            return true
          end,
        })

        -- Register additional sources with optimized settings
        compat.register_source('snippets', {
          priority = 600,
          get_trigger_characters = function()
            return {}
          end,
          is_available = function()
            return true
          end,
        }) -- Ensure the CodeCompanion autocomplete works properly
        vim.api.nvim_create_autocmd('FileType', {
          pattern = 'codecompanion',
          callback = function()
            -- Force enable completion for codecompanion buffers
            local blink_cmp = require 'blink.cmp'
            if blink_cmp and blink_cmp.setup_buffer then
              blink_cmp.setup_buffer {
                trigger = {
                  auto = true,
                  delay_ms = 0,
                  auto_after_trigger = 0,
                },
              }
            end
          end,
        })

        -- Add special handler to force instant auto-completion
        local blink_cmp_loaded = pcall(require, 'blink.cmp')
        if blink_cmp_loaded then
          -- Create a global function to force show the completion menu
          _G.force_blink_completion = function()
            local blink_cmp = require 'blink.cmp'
            if blink_cmp and blink_cmp.complete then
              blink_cmp.complete { trigger_auto = true }
            end
          end

          -- Create an autocmd to force completion on text changes in codecompanion buffers
          vim.api.nvim_create_autocmd('TextChangedI', {
            group = vim.api.nvim_create_augroup('BlinkcmpCodeCompanionForce', { clear = true }),
            pattern = { '*.codecompanion' },
            callback = function()
              vim.defer_fn(function()
                vim.cmd 'lua _G.force_blink_completion()'
              end, 0)
            end,
          })
        end
      end
    else
      vim.notify('Failed to initialize blink.compat properly', vim.log.levels.WARN)
    end
  end,
}
