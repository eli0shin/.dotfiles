# diff-review-comments.nvim

Annotate code diffs with review comments and send them to an AI provider for analysis.

Works with [diffview.nvim](https://github.com/sindrets/diffview.nvim), [octo.nvim](https://github.com/pwntester/octo.nvim), and native Vim diff mode.

## Usage

1. Open a diff view (diffview, octo PR review, or `:diffsplit`)
2. Visually select code and press `<leader>dca` to add a comment
3. Repeat across files — comments are stored per-repo as JSON
4. Press `<leader>dcr` to build a markdown prompt from all comments and run it through a configured provider

## Keymaps

| Key           | Mode   | Action                      |
| ------------- | ------ | --------------------------- |
| `<leader>dca` | visual | Add comment from selection  |
| `<leader>dca` | normal | Add comment from motion     |
| `<leader>dcl` | normal | List/edit/delete comments   |
| `<leader>dcr` | normal | Run review prompt           |
| `<leader>dcx` | normal | Clear all comments for repo |

## Commands

- `:DiffReviewCommentAdd` — add comment
- `:DiffReviewCommentList` — list comments
- `:DiffReviewCommentRun` — run review prompt
- `:DiffReviewCommentClear` — clear comments

## Installation

Local plugin via [lazy.nvim](https://github.com/folke/lazy.nvim):

```lua
{
  dir = '/path/to/diff-review-comments',
  name = 'diff-review-comments',
  lazy = false,
  config = function()
    require('diff_review_comments').setup()
  end,
  provider = 'opencode',
}
```

## Configuration

All options with defaults:

```lua
require('diff_review_comments').setup {
  provider = 'opencode',
  keymaps = {
    add = '<leader>dca',
    list = '<leader>dcl',
    run = '<leader>dcr',
    clear = '<leader>dcx',
  },
  max_selection_lines = 200,
  storage_path = vim.fn.stdpath('data') .. '/diff-review-comments/comments.json',
  notify = true,
  terminal = {
    height = 15,
  },
  providers = {
    opencode = {
      provider_id = 'openai',
      model_id = 'gpt-5.3-codex',
      template = 'opencode --model {provider_id}/{model_id} --prompt {prompt_text}',
    },
    claude = {
      template = 'claude < {prompt_file}',
    },
    custom = {
      template = '',
    },
  },
}
```

### Provider templates

Templates support these variables:

| Variable          | Description                        |
| ----------------- | ---------------------------------- |
| `{prompt_file}`   | Path to the generated prompt file  |
| `{prompt_text}`   | The prompt content (shell-escaped) |
| `{provider_id}`   | Provider ID from config            |
| `{model_id}`      | Model ID from config               |
| `{cwd}`           | Repository root (shell-escaped)    |
| `{comment_count}` | Number of comments                 |

## Comment list UI

The list view (`<leader>dcl`) shows all open comments with code previews and diff change markers (`+`/`-`).

| Key    | Action               |
| ------ | -------------------- |
| `<CR>` | Open file at comment |
| `e`    | Edit comment text    |
| `dd`   | Delete comment       |
| `X`    | Clear all comments   |
| `r`    | Refresh list         |
| `q`    | Close                |

## Supported diff sources

- **diffview.nvim** — full support including commit comparison context
- **octo.nvim** — GitHub PR review diffs with base/head commit tracking
- **Generic vim diff** — any `:diffsplit` or diff mode window
