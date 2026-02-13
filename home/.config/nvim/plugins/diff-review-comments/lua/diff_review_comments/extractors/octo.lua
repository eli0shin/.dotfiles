local M = {}

local utils = require 'diff_review_comments.utils'

local function current_compare()
  local ok, reviews = pcall(require, 'octo.reviews')
  if not ok or not reviews.get_current_review then
    return nil
  end

  local review = reviews.get_current_review()
  if not review then
    return nil
  end

  local base = review.layout and review.layout.left and review.layout.left.commit or nil
  local head = review.layout and review.layout.right and review.layout.right.commit or nil

  if not base and review.pull_request and review.pull_request.left then
    base = review.pull_request.left.commit
  end
  if not head and review.pull_request and review.pull_request.right then
    head = review.pull_request.right.commit
  end

  if not base and not head then
    return nil
  end

  return {
    base = base,
    head = head,
  }
end

local function find_peer_buffer(path, split, current_bufnr)
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if buf ~= current_bufnr and vim.api.nvim_buf_is_loaded(buf) then
      local ok, props = pcall(vim.api.nvim_buf_get_var, buf, 'octo_diff_props')
      if ok and props and props.path == path and props.split ~= split then
        return buf
      end
    end
  end
  return nil
end

function M.extract(selection)
  local bufnr = vim.api.nvim_get_current_buf()
  local ok, props = pcall(vim.api.nvim_buf_get_var, bufnr, 'octo_diff_props')
  if not ok or not props then
    return nil
  end

  local side = props.split == 'LEFT' and 'from' or 'to'
  local selected_side = side
  local peer_buf = find_peer_buffer(props.path, props.split, bufnr)
  local compare = current_compare()

  local current_lines = utils.get_lines(bufnr, selection.start.line, selection["end"].line)
  local selected_block = {
    line_start = selection.start.line,
    line_end = selection['end'].line,
    code = current_lines,
  }
  local peer_lines = nil
  if peer_buf then
    peer_lines = utils.get_lines(peer_buf, selection.start.line, selection["end"].line)
  end

  local from_block = nil
  local to_block = nil
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
  else
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
  end

  local final_side = side
  if from_block and to_block then
    final_side = 'both'
  end

  return {
    source = {
      extractor = 'octo',
      buffer_name = vim.api.nvim_buf_get_name(bufnr),
      filetype = vim.bo[bufnr].filetype,
      octo_split = props.split,
    },
    file = {
      abs_path = props.path or vim.api.nvim_buf_get_name(bufnr),
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
