return {
  'shortcuts/no-neck-pain.nvim',
  config = function()
    require('no-neck-pain').setup {
      -- Prints useful logs about triggered events, and reasons actions are executed.
      --- @type boolean
      debug = false,
      -- The width of the focused window that will be centered. When the terminal width is less than the `width` option, the side buffers won't be created.
      --- @type integer|"textwidth"|"colorcolumn"
      width = 140,
      -- Represents the lowest width value a side buffer should be.
      -- This option can be useful when switching window size frequently, example:
      -- in full screen screen, width is 210, you define an NNP `width` of 100, which creates each side buffer with a width of 50. If you resize your terminal to the half of the screen, each side buffer would be of width 5 and thereforce might not be useful and/or add "noise" to your workflow.
      --- @type integer
      minSideBufferWidth = 10,
      -- Disables the plugin if the last valid buffer in the list have been closed.
      --- @type boolean
      disableOnLastBuffer = false,
      -- When `true`, disabling the plugin closes every other windows except the initially focused one.
      --- @type boolean
      killAllBuffersOnDisable = false,
      -- Adds autocmd (@see `:h autocmd`) which aims at automatically enabling the plugin.
      --- @type table
      autocmds = {
        -- When `true`, enables the plugin when you start Neovim.
        -- If the main window is  a side tree (e.g. NvimTree) or a dashboard, the command is delayed until it finds a valid window.
        -- The command is cleaned once it has successfuly ran once.
        --- @type boolean
        enableOnVimEnter = true,
        -- When `true`, enables the plugin when you enter a new Tab.
        -- note: it does not trigger if you come back to an existing tab, to prevent unwanted interfer with user's decisions.
        --- @type boolean
        enableOnTabEnter = false,
        -- When `true`, reloads the plugin configuration after a colorscheme change.
        --- @type boolean
        reloadOnColorSchemeChange = false,
        -- When `true`, entering one of no-neck-pain side buffer will automatically skip it and go to the next available buffer.
        --- @type boolean
        skipEnteringNoNeckPainBuffer = true,
      },
      buffers = {
        scratchPad = {
          -- set to `false` to
          -- disable auto-saving
          enabled = false,
          -- set to `nil` to default
          -- to current working directory
          location = '~/code/notes/',
        },
        bo = {
          filetype = 'md',
        },
      },
      -- Creates mappings for you to easily interact with the exposed commands.
      --- @type table
      mappings = {
        -- When `true`, creates all the mappings that are not set to `false`.
        --- @type boolean
        enabled = true,
        -- Sets a global mapping to Neovim, which allows you to toggle the plugin.
        -- When `false`, the mapping is not created.
        --- @type string
        toggle = '<Leader>np',
        -- Sets a global mapping to Neovim, which allows you to toggle the left side buffer.
        -- When `false`, the mapping is not created.
        --- @type string
        toggleLeftSide = '<Leader>nql',
        -- Sets a global mapping to Neovim, which allows you to toggle the right side buffer.
        -- When `false`, the mapping is not created.
        --- @type string
        toggleRightSide = '<Leader>nqr',
        -- Sets a global mapping to Neovim, which allows you to increase the width (+5) of the main window.
        -- When `false`, the mapping is not created.
        --- @type string | { mapping: string, value: number }
        widthUp = '<Leader>n=',
        -- Sets a global mapping to Neovim, which allows you to decrease the width (-5) of the main window.
        -- When `false`, the mapping is not created.
        --- @type string | { mapping: string, value: number }
        widthDown = '<Leader>n-',
        -- Sets a global mapping to Neovim, which allows you to toggle the scratchPad feature.
        -- When `false`, the mapping is not created.
        --- @type string
        scratchPad = '<Leader>ns',
      },
    }
  end,
}
