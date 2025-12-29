---@param target table The base table that will be modified with values from source
---@param source table The table whose values will overwrite matching keys in target
---@return table The modified target table with source values merged in
-- Deep merge function to recursively merge tables
-- Values from source will overwrite values in target for the same keys
-- For nested tables, the merge happens recursively
local function deep_merge(target, source)
  for k, v in pairs(source) do
    if type(v) == 'table' and type(target[k]) == 'table' then
      deep_merge(target[k], v)
    else
      target[k] = v
    end
  end
  return target
end

return deep_merge
