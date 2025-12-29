return {
  { 'tpope/vim-sleuth', event = { 'BufReadPre', 'BufNewFile' } },
  { 'tpope/vim-fugitive', event = 'VeryLazy', cmd = { 'Git', 'Gstatus', 'Gblame', 'Gpush', 'Gpull' } },
  { 'tpope/vim-rhubarb', dependencies = { 'tpope/vim-fugitive' }, event = 'VeryLazy' },
}
