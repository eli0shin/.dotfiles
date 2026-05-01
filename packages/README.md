# Packages

Package management for Homebrew, bash-installed tools, and npm registry packages installed globally with Bun.

## Files

- `Brewfile` - Core packages for all machines (work + personal)
- `Brewfile.personal` - Personal apps (Mac App Store, Go tools) - skip on work machines
- `Brewfile.work` - Work-only Homebrew packages
- `bash-packages.json` - Core packages installed by custom shell commands
- `bash-packages.personal.json` - Personal-only custom shell packages
- `bash-packages.work.json` - Work-only custom shell packages
- `npm-packages` - Core npm registry packages installed globally with Bun, one package per line
- `npm-packages.personal` - Personal-only npm registry packages
- `npm-packages.work` - Work-only npm registry packages

## Usage

### Install core packages
```bash
brew bundle --file=~/.dotfiles/packages/Brewfile
```

### Install personal packages
```bash
brew bundle --file=~/.dotfiles/packages/Brewfile.personal
```

### Install everything
```bash
brew bundle --file=~/.dotfiles/packages/Brewfile
brew bundle --file=~/.dotfiles/packages/Brewfile.personal
```

### Update Brewfile from installed packages
```bash
brew bundle dump --file=~/.dotfiles/packages/Brewfile --force
```

## Adding packages

Use the `dot` CLI:
```bash
dot package add <package>    # Adds to Brewfile and installs
dot package add <package> --npm # Adds to npm-packages and installs with bun add -g
dot package remove <package> # Removes from Brewfile and uninstalls
dot package list             # Shows Brewfile contents
```

Or manually edit the package files and run `dot package install`.
