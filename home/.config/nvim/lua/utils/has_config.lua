--- Config files that indicate a project uses a specific tool.
--- To add a new tool, add an entry here and reference it via has_config(dirname, 'tool_name').
local config_files = {
  prettier = {
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.toml',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
  },
  oxfmt = { '.oxfmtrc.json', '.oxfmtrc.jsonc' },
  biome = { 'biome.json', 'biome.jsonc' },
  oxlint = { '.oxlintrc.json', 'oxlintrc.json', 'oxlint.config.ts' },
  eslint = {
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.cjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
  },
  deno = { 'deno.json', 'deno.jsonc' },
  stylua = { '.stylua.toml', 'stylua.toml' },
}

--- Check if a project has a config file for a given tool by walking up from dirname.
---@param dirname string Directory to start searching from (typically the buffer's parent dir)
---@param tool string Tool name matching a key in config_files
---@return boolean
local function has_config(dirname, tool)
  local files = config_files[tool]
  if not files then
    return false
  end
  return vim.fs.find(files, { path = dirname, upward = true })[1] ~= nil
end

return has_config
