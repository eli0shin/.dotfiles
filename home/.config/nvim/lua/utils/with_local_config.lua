local deep_merge = require 'utils.deep_merge'

---@param module_name string # The name of the module to require (e.g. 'plugins.module-local')
---@param config table # The default configuration to merge with
---@return table # The merged configuration
local function with_local_config(module_name, config)
  local ok, local_config = pcall(require, module_name)
  if ok and local_config then
    return deep_merge(config, local_config)
  end
  return config
end

return with_local_config
