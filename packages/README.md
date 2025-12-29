# Packages

Homebrew package management using Brewfiles.

## Files

- `Brewfile` - Core packages for all machines (work + personal)
- `Brewfile.personal` - Personal apps (Mac App Store, Go tools) - skip on work machines

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
dot package remove <package> # Removes from Brewfile and uninstalls
dot package list             # Shows Brewfile contents
```

Or manually edit the Brewfile and run `brew bundle`.
