return {
  'David-Kunz/jester',
  lazy = true, -- Enable lazy loading
  dependencies = {
    'mfussenegger/nvim-dap',
  },
  keys = {
    {
      '<leader>rt',
      function()
        require('jester').run()
      end,
      desc = '[R]un [T]est',
    },
    {
      '<leader>rf',
      function()
        require('jester').run_file()
      end,
      desc = '[R]un [F]ile Tests',
    },
    {
      '<leader>rl',
      function()
        require('jester').run_last()
      end,
      desc = '[R]un [L]ast Test',
    },
    {
      '<leader>dt',
      function()
        require('jester').debug()
      end,
      desc = '[D]ebug [T]est',
    },
    {
      '<leader>df',
      function()
        require('jester').debug_file()
      end,
      desc = '[D]ebug [F]ile Test',
    },
    {
      '<leader>dl',
      function()
        require('jester').debug_last()
      end,
      desc = '[D]ebug [L]ast Test',
    },
  },
  config = function()
    require('jester').setup {
      -- cmd = "npx jest -t '$result' $file", -- run command
      identifiers = { 'test', 'it' }, -- used to identify tests
      prepend = { 'describe' }, -- prepend describe blocks
      expressions = { 'call_expression' }, -- tree-sitter object used to scan for tests/describe blocks
      path_to_jest_run = 'npx jest', -- used to run tests
      path_to_jest_debug = './node_modules/.bin/jest', -- used for debugging
      terminal_cmd = ':vsplit | terminal', -- used to spawn a terminal for running tests, for debugging refer to nvim-dap's config
      dap = { -- debug adapter configuration
        type = 'pwa-node',
        request = 'launch',
        cwd = vim.fn.getcwd(),
        sourceMaps = false,
      },
    }
  end,
}
