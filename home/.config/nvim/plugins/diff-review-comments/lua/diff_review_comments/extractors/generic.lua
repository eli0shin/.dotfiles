local M = {}

local utils = require 'diff_review_comments.utils'

local function get_peer_win_buf(current_win)
  local wins = vim.api.nvim_tabpage_list_wins(0)
  local current_pos = vim.api.nvim_win_get_position(current_win)
  local diff_wins = {}

  for _, win in ipairs(wins) do
    if vim.wo[win].diff then
      local pos = vim.api.nvim_win_get_position(win)
      table.insert(diff_wins, { win = win, row = pos[1], col = pos[2] })
    end
  end

  table.sort(diff_wins, function(a, b)
    return a.col < b.col
  end)

  if #diff_wins < 2 then
    return nil, 'unknown'
  end

  local current_index = nil
  for i, item in ipairs(diff_wins) do
    if item.win == current_win then
      current_index = i
      break
    end
  end

  if not current_index then
    return nil, 'unknown'
  end

  local side = 'unknown'
  if current_index == 1 then
    side = 'from'
  elseif current_index == #diff_wins then
    side = 'to'
  end

  local peer = nil
  if current_index == 1 then
    peer = diff_wins[2]
  else
    peer = diff_wins[current_index - 1]
  end

  return peer and vim.api.nvim_win_get_buf(peer.win) or nil, side
end

function M.extract(selection)
  local win = vim.api.nvim_get_current_win()
  if not vim.wo[win].diff then
    return nil
  end

  local bufnr = vim.api.nvim_get_current_buf()
  local peer_buf, side = get_peer_win_buf(win)
  local selected_side = side

  local from_block = nil
  local to_block = nil
  local current_lines = utils.get_lines(bufnr, selection.start.line, selection["end"].line)
  local selected_block = {
    line_start = selection.start.line,
    line_end = selection['end'].line,
    code = current_lines,
  }
  local peer_lines = peer_buf and utils.get_lines(peer_buf, selection.start.line, selection["end"].line) or nil

  if side == 'from' then
    from_block = {
      line_start = selection.start.line,
      line_end = selection["end"].line,
      code = current_lines,
    }
    if peer_lines then
      to_block = {
        line_start = selection.start.line,
        line_end = selection["end"].line,
        code = peer_lines,
      }
    end
  elseif side == 'to' then
    to_block = {
      line_start = selection.start.line,
      line_end = selection["end"].line,
      code = current_lines,
    }
    if peer_lines then
      from_block = {
        line_start = selection.start.line,
        line_end = selection["end"].line,
        code = peer_lines,
      }
    end
  else
    to_block = {
      line_start = selection.start.line,
      line_end = selection["end"].line,
      code = current_lines,
    }
  end

  local final_side = side
  if from_block and to_block then
    final_side = 'both'
  end

  return {
    source = {
      extractor = 'generic',
      buffer_name = vim.api.nvim_buf_get_name(bufnr),
      filetype = vim.bo[bufnr].filetype,
    },
    file = {
      abs_path = vim.api.nvim_buf_get_name(bufnr),
    },
    diff = {
      side = final_side,
      selected_side = selected_side,
      compare = {},
      selected = selected_block,
      from = from_block,
      to = to_block,
    },
  }
end

return M
