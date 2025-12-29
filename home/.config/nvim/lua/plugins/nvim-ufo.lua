return {
  'kevinhwang91/nvim-ufo',
  dependencies = {
    'kevinhwang91/promise-async',
    'nvim-treesitter/nvim-treesitter',
  },
  event = 'BufReadPost',
  opts = {
    -- Use treesitter as the main provider, with LSP as fallback
    provider_selector = function(bufnr, filetype, buftype)
      return { 'treesitter', 'indent' }
    end,
    -- Preview configuration
    preview = {
      win_config = {
        border = { '', '─', '', '', '', '─', '', '' },
        winhighlight = 'Normal:Folded',
        winblend = 0,
      },
      mappings = {
        scrollU = '<C-u>',
        scrollD = '<C-d>',
        jumpTop = '[',
        jumpBot = ']',
      },
    },
    -- Fold text configuration
    fold_virt_text_handler = function(virtText, lnum, endLnum, width, truncate)
      local newVirtText = {}
      local suffix = (' 󰁂 %d '):format(endLnum - lnum)
      local sufWidth = vim.fn.strdisplaywidth(suffix)
      local targetWidth = width - sufWidth
      local curWidth = 0
      for _, chunk in ipairs(virtText) do
        local chunkText = chunk[1]
        local chunkWidth = vim.fn.strdisplaywidth(chunkText)
        if targetWidth > curWidth + chunkWidth then
          table.insert(newVirtText, chunk)
        else
          chunkText = truncate(chunkText, targetWidth - curWidth)
          local hlGroup = chunk[2]
          table.insert(newVirtText, { chunkText, hlGroup })
          chunkWidth = vim.fn.strdisplaywidth(chunkText)
          -- str width returned from truncate() may less than 2nd argument, need padding
          if curWidth + chunkWidth < targetWidth then
            suffix = suffix .. (' '):rep(targetWidth - curWidth - chunkWidth)
          end
          break
        end
        curWidth = curWidth + chunkWidth
      end
      table.insert(newVirtText, { suffix, 'MoreMsg' })
      return newVirtText
    end,
  },
  init = function()
    -- Using ufo provider need remap `zR` and `zM`.
    vim.keymap.set('n', 'zR', function()
      require('ufo').openAllFolds()
    end, { desc = 'Open all folds' })
    vim.keymap.set('n', 'zM', function()
      require('ufo').closeAllFolds()
    end, { desc = 'Close all folds' })
    vim.keymap.set('n', 'zr', function()
      require('ufo').openFoldsExceptKinds()
    end, { desc = 'Open folds except kinds' })
    vim.keymap.set('n', 'zm', function()
      require('ufo').closeFoldsWith()
    end, { desc = 'Close folds with' })
    vim.keymap.set('n', 'zp', function()
      require('ufo').peekFoldedLinesUnderCursor()
    end, { desc = 'Peek folded lines' })

    -- Set fold level and enable folding
    vim.opt.foldlevel = 99
    vim.opt.foldlevelstart = 99
    vim.opt.foldenable = true
    vim.opt.foldcolumn = '1' -- Show fold column
  end,
}
