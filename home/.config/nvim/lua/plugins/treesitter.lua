return {
  { -- Highlight, edit, and navigate code
    'nvim-treesitter/nvim-treesitter',
    branch = 'main',
    lazy = false,
    build = ':TSUpdate',
    config = function()
      require('nvim-treesitter').setup {}

      -- Install parsers (async, no-op if already installed)
      require('nvim-treesitter').install {
        'bash',
        'c',
        'html',
        'lua',
        'luadoc',
        'markdown',
        'markdown_inline',
        'vim',
        'vimdoc',
        'javascript',
        'typescript',
      }

      -- Enable treesitter highlighting and indentation per filetype
      vim.api.nvim_create_autocmd('FileType', {
        callback = function(args)
          local buf = args.buf
          local name = vim.api.nvim_buf_get_name(buf)

          -- Skip diffview buffers
          if name:find('diffview://', 1, true) then
            return
          end

          local ft = vim.bo[buf].filetype
          local lang = vim.treesitter.language.get_lang(ft)

          if lang and vim.treesitter.language.add(lang) then
            vim.treesitter.start(buf, lang)
            vim.bo[buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
          end
        end,
      })
    end,
  },
  {
    'nvim-treesitter/nvim-treesitter-textobjects',
    branch = 'main',
    event = 'VeryLazy',
    config = function()
      require('nvim-treesitter-textobjects').setup {
        select = {
          lookahead = true,
          selection_modes = {
            ['@parameter.outer'] = 'v',
            ['@function.outer'] = 'V',
            ['@class.outer'] = '<c-v>',
          },
          include_surrounding_whitespace = true,
        },
      }

      -- Select textobject keymaps
      for _, mode in ipairs { 'x', 'o' } do
        vim.keymap.set(mode, 'af', function()
          require('nvim-treesitter-textobjects.select').select_textobject('@function.outer', 'textobjects')
        end, { desc = 'Select outer function' })
        vim.keymap.set(mode, 'if', function()
          require('nvim-treesitter-textobjects.select').select_textobject('@function.inner', 'textobjects')
        end, { desc = 'Select inner function' })
        vim.keymap.set(mode, 'ac', function()
          require('nvim-treesitter-textobjects.select').select_textobject('@class.outer', 'textobjects')
        end, { desc = 'Select outer class' })
        vim.keymap.set(mode, 'ic', function()
          require('nvim-treesitter-textobjects.select').select_textobject('@class.inner', 'textobjects')
        end, { desc = 'Select inner class' })
        vim.keymap.set(mode, 'as', function()
          require('nvim-treesitter-textobjects.select').select_textobject('@local.scope', 'locals')
        end, { desc = 'Select language scope' })
      end
    end,
  },
}
