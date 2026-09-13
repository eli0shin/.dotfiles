local function select_next_entry() require('diffview.actions').select_next_entry() end

local function select_prev_entry() require('diffview.actions').select_prev_entry() end

local function attach_file_navigation_keymaps(bufnr)
  vim.keymap.set('n', '<M-j>', select_next_entry, {
    buffer = bufnr,
    desc = 'Open the diff for the next file',
    nowait = true,
    silent = true,
  })
  vim.keymap.set('n', '<M-k>', select_prev_entry, {
    buffer = bufnr,
    desc = 'Open the diff for the previous file',
    nowait = true,
    silent = true,
  })
end

local function file_navigation_keymaps()
  return {
    { 'n', '<tab>', false },
    { 'n', '<s-tab>', false },
    { 'n', '<M-j>', select_next_entry, { desc = 'Open the diff for the next file' } },
    { 'n', '<M-k>', select_prev_entry, { desc = 'Open the diff for the previous file' } },
  }
end

local function hunk_navigation(direction)
  local key = direction > 0 and ']c' or '[c'

  return function()
    local winid = vim.api.nvim_get_current_win()
    local view = require('diffview.lib').get_current_view()

    local function navigation_window()
      if vim.api.nvim_win_is_valid(winid) and vim.wo[winid].diff then
        return winid
      end

      local main_window = view and view.cur_layout and view.cur_layout:get_main_win()
      if main_window and vim.api.nvim_win_is_valid(main_window.id) then
        winid = main_window.id
        return winid
      end
    end

    local function jump_in_current_file()
      local target_winid = navigation_window()
      if not target_winid then
        return false
      end

      return vim.api.nvim_win_call(target_winid, function()
        local before = vim.api.nvim_win_get_cursor(0)
        vim.cmd.normal({ '1' .. key, bang = true })
        return not vim.deep_equal(before, vim.api.nvim_win_get_cursor(0))
      end)
    end

    local function jump_to_edge_hunk()
      local target_winid = navigation_window()
      if not target_winid then
        return false
      end

      return vim.api.nvim_win_call(target_winid, function()
        local line_count = vim.api.nvim_buf_line_count(0)
        local line = direction > 0 and 1 or line_count
        vim.api.nvim_win_set_cursor(0, { line, 0 })

        if direction > 0 and (vim.fn.diff_hlID(line, 1) ~= 0 or vim.fn.diff_filler(line) > 0) then
          return true
        end

        if direction < 0 then
          local at_last_hunk = vim.fn.diff_hlID(line, 1) ~= 0
            or vim.fn.diff_filler(line) > 0
            or vim.fn.diff_filler(line + 1) > 0

          if at_last_hunk then
            while line > 1 and vim.fn.diff_hlID(line - 1, 1) ~= 0 do
              line = line - 1
            end
            vim.api.nvim_win_set_cursor(0, { line, 0 })
            return true
          end
        end

        local before = vim.api.nvim_win_get_cursor(0)
        vim.cmd.normal({ '1' .. key, bang = true })
        local after = vim.api.nvim_win_get_cursor(0)

        return not vim.deep_equal(before, after)
          or vim.fn.diff_hlID(after[1], 1) ~= 0
          or vim.fn.diff_filler(after[1]) > 0
          or (after[1] == line_count and vim.fn.diff_filler(line_count + 1) > 0)
      end)
    end

    local function adjacent_file()
      if not view or not view.panel or type(view.panel.ordered_file_list) ~= 'function' then
        return nil
      end

      local files = view.panel:ordered_file_list()
      for index, file in ipairs(files) do
        if file == view.panel.cur_file then
          return files[(index - 1 + direction) % #files + 1], #files
        end
      end
    end

    local navigate, scan_adjacent_files

    scan_adjacent_files = function(remaining, attempts)
      if attempts == 0 then
        return
      end

      local file = adjacent_file()
      if not file then
        return
      end

      if file == view.panel.cur_file then
        if jump_to_edge_hunk() then
          navigate(remaining - 1)
        end
        return
      end

      view.emitter:once('file_open_post', function()
        vim.schedule(function()
          if jump_to_edge_hunk() then
            navigate(remaining - 1)
          else
            scan_adjacent_files(remaining, attempts - 1)
          end
        end)
      end)
      view:set_file(file, false, true)
    end

    navigate = function(remaining)
      while remaining > 0 and jump_in_current_file() do
        remaining = remaining - 1
      end

      if remaining > 0 then
        local _, file_count = adjacent_file()
        scan_adjacent_files(remaining, file_count or 0)
      end
    end

    navigate(vim.v.count1)
  end
end

local view_keymaps = file_navigation_keymaps()
-- Disable the default <leader>e keymap to avoid conflict with LSP diagnostics
table.insert(view_keymaps, { 'n', '<leader>e', false })
table.insert(view_keymaps, { 'n', ']c', hunk_navigation(1), { desc = 'Go to next hunk across files' } })
table.insert(view_keymaps, { 'n', '[c', hunk_navigation(-1), { desc = 'Go to previous hunk across files' } })

return {
  'sindrets/diffview.nvim',
  lazy = true,
  cmd = { 'DiffviewOpen', 'DiffviewFileHistory' },
  init = function()
    local group = vim.api.nvim_create_augroup('diffview_file_navigation', { clear = true })
    vim.api.nvim_create_autocmd('BufEnter', {
      group = group,
      desc = 'Attach file navigation before Diffview finishes switching buffers',
      callback = function(args)
        if vim.api.nvim_buf_get_name(args.buf):match('^diffview://') then
          attach_file_navigation_keymaps(args.buf)
        end
      end,
    })
  end,
  keys = {
    { '<leader>b', '<cmd>DiffviewToggleFiles<cr>', desc = 'Toggle Diffview file panel' },
    { '<leader>d', group = '[D]iff' },
    { '<leader>dv', group = '[V]iew' },
    { '<leader>dvc', '<cmd>DiffviewClose<cr>', desc = '[C]lose' },
    { '<leader>dvo', '<cmd>DiffviewOpen<cr>', desc = '[O]pen' },
    { '<leader>dvi', ':DiffviewOpen ', desc = '[I]nsert Target Git Object' },
    { '<leader>dvr', function() require('pr_diff').reload() end, desc = '[R]eload PR' },
  },
  opts = {
    keymaps = {
      view = view_keymaps,
      file_panel = file_navigation_keymaps(),
      file_history_panel = file_navigation_keymaps(),
    },
  },
}
