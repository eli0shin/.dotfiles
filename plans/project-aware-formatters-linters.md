# Project-Aware Formatters & Linters — Implementation Plan

## Goal

Formatters and linters only run when a matching project config file is found by walking up from the buffer's directory. No config = no formatting/linting. ESLint continues via LSP (unchanged).

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `home/.config/nvim/lua/utils/has_config.lua` | **Create** — shared config-detection utility |
| `home/.config/nvim/lua/plugins/conform.lua` | **Modify** — project-aware formatters |
| `home/.config/nvim/lua/plugins/lint.lua` | **Modify** — project-aware linters |
| `home/.config/nvim/lua/plugins/lsp.lua` | **Modify** — add oxlint LSP, update Mason ensure_installed |

---

## 1. Create `utils/has_config.lua`

A single function that checks whether any of a list of filenames exist by walking up from a given directory. Every formatter/linter condition calls this.

```lua
--- Check if any of the given config files exist by walking up from `dir`.
--- Uses vim.fs.find with upward = true, stopping at filesystem root.
--- @param dir string — starting directory (typically ctx.dirname or buffer dir)
--- @param filenames string[] — list of config filenames to look for
--- @return string|nil — path of first match, or nil
local function has_config(dir, filenames)
  local found = vim.fs.find(filenames, { upward = true, path = dir })
  return found[1]
end

return has_config
```

This is intentionally simple — no caching, no root markers, no `stop` parameter. `vim.fs.find` walks up to `/` by default which is the correct behavior (a monorepo may have config at any level).

---

## 2. Modify `plugins/conform.lua`

### 2a. Config file tables

Define config file lists at the top of the file (or at the top of the `opts` function):

```lua
local has_config = require('utils.has_config')

local config_files = {
  oxfmt = { '.oxfmtrc.json', '.oxfmtrc.jsonc' },
  biome = { 'biome.json', 'biome.jsonc' },
  prettier = {
    '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs',
    '.prettierrc.mjs', '.prettierrc.toml', '.prettierrc.yaml', '.prettierrc.yml',
    'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
  },
  deno = { 'deno.json', 'deno.jsonc' },
  stylua = { '.stylua.toml', 'stylua.toml' },
}
```

### 2b. Custom formatter: oxfmt

oxfmt is not a built-in conform.nvim formatter. Define it in the `formatters` table:

```lua
formatters = {
  oxfmt = {
    command = 'oxfmt',
    args = { '--stdin-filepath', '$FILENAME' },
    stdin = true,
    condition = function(self, ctx)
      return has_config(ctx.dirname, config_files.oxfmt) ~= nil
    end,
  },
  -- ... other formatter overrides below
},
```

The `args` follow the same pattern as prettier (stdin + filepath for language detection). Verify actual CLI flags against `oxfmt --help` at implementation time.

### 2c. Condition functions on existing formatters

Override each built-in formatter to add a `condition`:

```lua
formatters = {
  oxfmt = { ... }, -- custom, see above
  biome = {
    condition = function(self, ctx)
      return has_config(ctx.dirname, config_files.biome) ~= nil
    end,
  },
  prettier = {
    prepend_args = { '--quote-props=preserve' },
    condition = function(self, ctx)
      return has_config(ctx.dirname, config_files.prettier) ~= nil
    end,
  },
  deno_fmt = {
    condition = function(self, ctx)
      return has_config(ctx.dirname, config_files.deno) ~= nil
    end,
  },
  stylua = {
    condition = function(self, ctx)
      return has_config(ctx.dirname, config_files.stylua) ~= nil
    end,
  },
},
```

### 2d. `formatters_by_ft` with `stop_after_first`

For web filetypes, list formatters in priority order. `stop_after_first = true` means conform tries each in order and uses the first one whose `condition` returns true.

Priority order: **oxfmt → biome → deno_fmt → prettier**

Rationale: oxfmt/biome are fast native tools and their config files are unambiguous signals of intent. deno_fmt before prettier because a `deno.json` is a stronger signal than `.prettierrc` in a Deno project. Prettier is last as the established default.

```lua
formatters_by_ft = {
  lua = { 'stylua' },
  javascript = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
  javascriptreact = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
  typescript = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
  typescriptreact = { 'oxfmt', 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
  json = { 'biome', 'deno_fmt', 'prettier', stop_after_first = true },
  jsonc = { 'biome', 'deno_fmt', stop_after_first = true },
  css = { 'biome', 'prettier', stop_after_first = true },
  html = { 'prettier' },
  graphql = { 'prettier' },
  markdown = { 'deno_fmt', 'prettier', stop_after_first = true },
  go = { 'gofmt', 'goimports' },
},
```

Notes:
- `go` keeps sequential (both run, no config detection — go tools work without config).
- `html` / `graphql` only have prettier support.
- `jsonc` — biome supports it, deno supports it, prettier does not.

### 2e. Handling LSP fallback — the critical change

The current config uses `lsp_fallback = true` which causes ts_ls (or other LSPs) to format when no conform formatter matches. This violates the "no config = do nothing" requirement.

**Approach**: Set `lsp_format = "never"` globally. This replaces `lsp_fallback` (which is the old API name for the same concept).

```lua
format_on_save = function(bufnr)
  if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
    return
  end
  return {
    timeout_ms = 1000,
    lsp_format = 'never',
  }
end,
```

And for the manual `<leader>f` keymap:

```lua
keys = {
  {
    '<leader>f',
    function()
      require('conform').format { async = true, lsp_format = 'never' }
    end,
    mode = '',
    desc = '[F]ormat buffer',
  },
},
```

This means: conform formatters only, never LSP. If no conform formatter's condition passes, nothing happens. This is exactly the desired behavior.

**Exception — Go and Lua**: These filetypes don't need config detection (gofmt/stylua are always desired when editing those filetypes). If you later want LSP fallback for specific filetypes, convert `format_on_save` to check `vim.bo[bufnr].filetype` and return `lsp_format = 'fallback'` for those filetypes only.

For this plan: keep it simple with `lsp_format = 'never'` across the board. `gofmt`/`goimports`/`stylua` run via conform directly, no LSP fallback needed.

### 2f. Complete conform.lua structure

```lua
local has_config = require('utils.has_config')

local config_files = { ... } -- as above

-- FormatDisable/FormatEnable commands (unchanged)
vim.api.nvim_create_user_command('FormatDisable', function(args) ... end, { ... })
vim.api.nvim_create_user_command('FormatEnable', function() ... end, { ... })

return {
  'stevearc/conform.nvim',
  lazy = true,
  event = 'VeryLazy',
  keys = {
    {
      '<leader>f',
      function()
        require('conform').format { async = true, lsp_format = 'never' }
      end,
      mode = '',
      desc = '[F]ormat buffer',
    },
  },
  opts = {
    notify_on_error = true,
    format_on_save = function(bufnr)
      if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
        return
      end
      return { timeout_ms = 1000, lsp_format = 'never' }
    end,
    formatters = {
      oxfmt = { ... },
      biome = { condition = ... },
      prettier = { prepend_args = ..., condition = ... },
      deno_fmt = { condition = ... },
      stylua = { condition = ... },
    },
    formatters_by_ft = { ... },
  },
}
```

---

## 3. Modify `plugins/lint.lua`

### 3a. Linter selection approach

Unlike formatters where conform has `stop_after_first`, nvim-lint has no built-in priority mechanism. Instead, dynamically build the linter list in the autocmd callback based on which config files exist.

### 3b. Config file tables for linters

```lua
local has_config = require('utils.has_config')

local config_files = {
  oxlint = { '.oxlintrc.json', 'oxlintrc.json', 'oxlint.config.ts' },
  biome = { 'biome.json', 'biome.jsonc' },
}
```

### 3c. Linter priority

Priority order: **oxlint → biome**

Use first-match (stop after first found). Rationale: oxlint is the primary ESLint replacement. biome can also lint but if oxlint config exists, prefer it. ESLint continues running via LSP regardless.

### 3d. Web filetypes set

```lua
local web_fts = {
  javascript = true, javascriptreact = true,
  typescript = true, typescriptreact = true,
  json = true, jsonc = true,
}
```

### 3e. Dynamic linter resolution in autocmd

```lua
vim.api.nvim_create_autocmd({ 'BufEnter', 'BufWritePost', 'InsertLeave' }, {
  group = lint_augroup,
  callback = function(event)
    local buf = event.buf
    local ft = vim.bo[buf].filetype
    if not web_fts[ft] then
      return
    end

    local dir = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(buf), ':h')
    local linters = {}

    if has_config(dir, config_files.oxlint) then
      table.insert(linters, 'oxlint')
    elseif has_config(dir, config_files.biome) then
      table.insert(linters, 'biome')
    end

    if #linters > 0 then
      require('lint').try_lint(linters, { ignore_errors = true })
    end
  end,
})
```

Key points:
- No `linters_by_ft` table — linters are resolved dynamically per-buffer.
- `try_lint(linters)` takes an explicit list, bypassing `linters_by_ft`.
- If no config found, nothing runs. No fallback.
- ESLint is NOT in this list — it runs via LSP.

### 3f. biome as nvim-lint linter

nvim-lint does not have a built-in `biome` linter. Define a custom one:

```lua
local lint = require('lint')

lint.linters.biome = {
  cmd = 'biome',
  args = { 'lint', '--stdin-file-path', function() return vim.api.nvim_buf_get_name(0) end },
  stdin = true,
  stream = 'stderr',
  parser = function(output, bufnr)
    -- biome outputs diagnostics in a structured format
    -- Parse biome's stderr output into vim diagnostics
    -- Implementation detail: check `biome lint --reporter=json` for structured output
    -- and parse JSON diagnostics
  end,
}
```

**Alternative approach (recommended)**: Use biome's LSP server instead of nvim-lint for linting. biome has excellent LSP support and this avoids writing a custom parser. If going the LSP route:
- Add `biome` to the servers table in `lsp.lua`
- Give it a `root_dir` that checks for `biome.json`/`biome.jsonc`
- It only attaches to buffers in projects with biome config (standard LSP root_dir behavior)

**Recommendation**: Use biome via LSP for linting (it handles config detection natively via root_dir). This means the nvim-lint config only needs oxlint. This simplifies things considerably.

### 3g. Revised lint.lua (biome via LSP approach)

```lua
local has_config = require('utils.has_config')

local linter_config_files = {
  oxlint = { '.oxlintrc.json', 'oxlintrc.json', 'oxlint.config.ts' },
}

local web_fts = {
  javascript = true, javascriptreact = true,
  typescript = true, typescriptreact = true,
}

return {
  {
    'mfussenegger/nvim-lint',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local lint_augroup = vim.api.nvim_create_augroup('lint', { clear = true })
      vim.api.nvim_create_autocmd({ 'BufEnter', 'BufWritePost', 'InsertLeave' }, {
        group = lint_augroup,
        callback = function(event)
          local buf = event.buf
          local ft = vim.bo[buf].filetype
          if not web_fts[ft] then
            return
          end

          local dir = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(buf), ':h')
          if has_config(dir, linter_config_files.oxlint) then
            require('lint').try_lint({ 'oxlint' }, { ignore_errors = true })
          end
        end,
      })
    end,
  },
}
```

---

## 4. Modify `plugins/lsp.lua`

### 4a. Add biome LSP server

```lua
local servers = {
  -- ... existing servers ...
  biome = {},
}
```

biome's LSP in nvim-lspconfig uses `root_dir = util.root_pattern('biome.json', 'biome.jsonc')` by default. It only attaches when biome config exists — project-aware by default.

### 4b. Oxlint — LSP vs nvim-lint decision

Oxlint has an LSP server (`oxlint` in nvim-lspconfig, merged May 2025, uses `oxc_language_server` binary). It uses `root_dir = root_pattern('.oxlintrc.json')` — project-aware by default.

**Decision**: Use oxlint via **nvim-lint** (not LSP). Reasons:
- nvim-lint's oxlint integration is mature and built-in.
- The oxlint LSP is newer and less battle-tested.
- nvim-lint gives us explicit control over when it runs.
- We already have the nvim-lint infrastructure from this plan.

If oxlint LSP matures and becomes preferable, migrating is straightforward: remove from nvim-lint, add to lsp.lua servers table.

### 4c. Update Mason ensure_installed

```lua
vim.list_extend(ensure_installed, {
  'stylua',
  'prettier',
  'biome',
  -- 'oxfmt',     -- install manually until Mason package available
  -- 'oxlint',    -- install manually until Mason package available
})
```

Note: `oxfmt` and `oxlint` may not be in the Mason registry yet. They can be installed via `npm install -g oxlint` or `cargo install oxfmt`/`cargo install oxlint`, or via brew if available. Add them to Mason's list once they're available in the registry. The conform/lint `condition` functions handle the case where the binary doesn't exist (conform skips unavailable formatters, nvim-lint's `ignore_errors = true` handles missing binaries).

### 4d. Remove eslint from ensure_installed?

No — keep `eslint = {}` in servers. ESLint LSP handles missing configs gracefully (it just doesn't report diagnostics). No changes needed.

---

## 5. Edge Cases

### 5a. Monorepos

`vim.fs.find` with `upward = true` walks from the buffer's directory upward. In a monorepo:

```
monorepo/
├── biome.json          ← root config
├── packages/
│   ├── app-a/
│   │   ├── .prettierrc ← app-a uses prettier
│   │   └── src/file.ts
│   └── app-b/
│       └── src/file.ts ← no local config, finds root biome.json
```

- `app-a/src/file.ts` → finds `.prettierrc` first (closer), uses prettier
- `app-b/src/file.ts` → walks up, finds `biome.json` at root, uses biome

This is correct behavior. The `stop_after_first` + `condition` approach naturally handles this because each formatter checks for its own config files independently. The priority order (oxfmt → biome → deno_fmt → prettier) determines which wins if multiple configs exist at the same level.

### 5b. Multiple configs at different levels

If both `.prettierrc` (in `./`) and `biome.json` (in `../../`) exist, both formatters' conditions return true. `stop_after_first` picks the higher-priority one (biome before prettier in the list). This may not always be desired — the closer config might be the intended one.

**Mitigation**: The priority order is chosen so that more specific tools (oxfmt, biome) win over more general ones (prettier). In practice, projects rarely have conflicting formatter configs at different directory levels. If this becomes an issue, the condition functions could be enhanced to compare found config depths — but don't build this preemptively.

### 5c. No config found

All conditions return false → `stop_after_first` finds no available formatter → conform does nothing. `lsp_format = 'never'` prevents LSP fallback. File saves without formatting. This is the desired behavior.

### 5d. Buffer has no file path

`vim.api.nvim_buf_get_name(0)` returns `""` for unsaved buffers. `vim.fn.fnamemodify("", ":h")` returns `"."`. `vim.fs.find` from `"."` uses CWD. This is acceptable — if CWD has a config, format; if not, don't.

For conform: `ctx.dirname` handles this similarly.

### 5e. Tool binary not installed

- **conform**: If `command` is not found on PATH, the formatter is marked unavailable (same as condition returning false). `stop_after_first` moves to the next.
- **nvim-lint**: `ignore_errors = true` suppresses errors from missing binaries.
- No special handling needed.

---

## 6. Adding New Tools in the Future

To add a new formatter:

1. Add its config files to `config_files` table in `conform.lua`
2. Add a `condition` to its formatter entry (or define a custom formatter if not built-in)
3. Insert it into the appropriate position in `formatters_by_ft` entries

To add a new linter:

1. Add its config files to `linter_config_files` in `lint.lua`
2. Add an `elseif` branch in the autocmd callback (or switch to a loop-based approach if the list grows)

To switch a tool from nvim-lint to LSP (or vice versa):

1. Remove from one, add to the other
2. LSP tools go in `lsp.lua` servers table (root_dir handles config detection)
3. nvim-lint tools go in `lint.lua` with explicit config detection

---

## 7. Summary of Changes

| What | Before | After |
|------|--------|-------|
| Formatters run | Always (static per-filetype) | Only when config file detected |
| LSP fallback formatting | Enabled (`lsp_fallback = true`) | Disabled (`lsp_format = 'never'`) |
| Formatter for web FTs | prettier only | oxfmt → biome → deno_fmt → prettier (first with config wins) |
| Linters for web FTs | None (commented out) | oxlint (when config detected) |
| biome linting | Not configured | Via LSP (auto-attaches when biome.json exists) |
| ESLint | Via LSP | Via LSP (unchanged) |
| stylua | Always runs | Runs when `.stylua.toml` / `stylua.toml` detected |
| go formatters | Always runs | Always runs (no config detection — go convention) |

## 8. Implementation Order

1. Create `utils/has_config.lua`
2. Modify `conform.lua` — all formatter changes
3. Modify `lint.lua` — oxlint with config detection
4. Modify `lsp.lua` — add biome LSP server, update Mason ensure_installed
5. Test: open files in projects with/without various configs, verify correct behavior
