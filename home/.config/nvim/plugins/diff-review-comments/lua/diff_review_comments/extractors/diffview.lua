local M = {}

local utils = require 'diff_review_comments.utils'

local function commit_from_rev(rev)
  if not rev then
    return nil
  end
  if type(rev) == 'table' and rev.commit and rev.commit ~= '' then
    return rev.commit
  end
  if type(rev) == 'string' and rev ~= '' then
    return rev
  end
  return nil
end

function M.extract(selection)
  -- Attempt to load diffview.lib to access internal state
  local ok_lib, lib = pcall(require, 'diffview.lib')
  if not ok_lib then
    return nil
  end

  -- Get the current view object from diffview and validate structure
  local view = lib.get_current_view()
  if not view or not view.cur_entry or not view.cur_entry.layout or not view.cur_entry.layout.files then
    return nil
  end

  -- Retrieve files involved in the current diff layout to identify context
  local bufnr = vim.api.nvim_get_current_buf()
  local files = view.cur_entry.layout:files()
  local current = nil
  local peer = nil

  for _, file in ipairs(files) do
    if file.bufnr == bufnr then
      current = file
    end
  end

  for _, file in ipairs(files) do
    if file.bufnr ~= bufnr then
      peer = file
      break
    end
  end

  if not current then
    return nil
  end

  local side = current.symbol == 'a' and 'from' or 'to'
  local selected_side = side
  local current_lines = utils.get_lines(bufnr, selection.start.line, selection['end'].line)
  local peer_lines = nil
  local revs = view.cur_entry.revs or {}
  local compare = {
    base = commit_from_rev(revs.a) or commit_from_rev(view.left),
    head = commit_from_rev(revs.b) or commit_from_rev(view.right),
  }
  if not compare.base and not compare.head then
    compare = nil
  end

  if peer and peer.bufnr then
    peer_lines = utils.get_lines(peer.bufnr, selection.start.line, selection['end'].line)
  end

  local selected_block = {
    line_start = selection.start.line,
    line_end = selection['end'].line,
    code = current_lines,
  }

  local from_block = nil
  local to_block = nil
  if side == 'from' then
    from_block = {
      line_start = selection.start.line,
      line_end = selection['end'].line,
      code = current_lines,
    }
    if peer_lines then
      to_block = {
        line_start = selection.start.line,
        line_end = selection['end'].line,
        code = peer_lines,
      }
    end
  else
    to_block = {
      line_start = selection.start.line,
      line_end = selection['end'].line,
      code = current_lines,
    }
    if peer_lines then
      from_block = {
        line_start = selection.start.line,
        line_end = selection['end'].line,
        code = peer_lines,
      }
    end
  end

  local final_side = side
  if from_block and to_block then
    final_side = 'both'
  end

  return {
    source = {
      extractor = 'diffview',
      buffer_name = vim.api.nvim_buf_get_name(bufnr),
      filetype = vim.bo[bufnr].filetype,
    },
    file = {
      abs_path = current.path or view.cur_entry.path or vim.api.nvim_buf_get_name(bufnr),
    },
    diff = {
      side = final_side,
      selected_side = selected_side,
      compare = compare,
      selected = selected_block,
      from = from_block,
      to = to_block,
    },
  }
end

return M
