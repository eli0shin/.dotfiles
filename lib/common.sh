# shellcheck shell=bash
# Shared paths, platform detection, and output helpers.
# Inspired by dmmulroy/.dotfiles

DOTFILES_DIR="${DOTFILES_DIR:-$HOME/.dotfiles}"
PACKAGES_DIR="$DOTFILES_DIR/packages"
SETTINGS_DIR="$DOTFILES_DIR/settings"
SCRIPTS_DIR="$DOTFILES_DIR/scripts"
BACKUP_DIR="$HOME/.dotfiles-backup"

# Managed symlink directories
SYMLINKS=(
    "$HOME/.config/nvim"
    "$HOME/.config/fish"
    "$HOME/.config/tmux"
    "$HOME/.config/ghostty"
    "$HOME/.config/git"
    "$HOME/.config/omf"
    "$HOME/.config/opencode"
    "$HOME/.homebrew"
    "$HOME/.agents"
    "$HOME/.claude"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Logging helpers
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if command exists
has() { command -v "$1" &>/dev/null; }

_is_macos() { [[ "$(uname -s)" == "Darwin" ]]; }

_has_systemd() { [[ -d /run/systemd/system ]] && has systemctl; }

_current_platform() {
    case "$(uname -s)" in
        Darwin) echo "darwin" ;;
        Linux) echo "linux" ;;
        *) echo "" ;;
    esac
}

_brew_shellenv_path() {
    if [[ -x /opt/homebrew/bin/brew ]]; then
        echo /opt/homebrew/bin/brew
    elif [[ -x /home/linuxbrew/.linuxbrew/bin/brew ]]; then
        echo /home/linuxbrew/.linuxbrew/bin/brew
    elif command -v brew >/dev/null 2>&1; then
        command -v brew
    fi
}

_load_brew_shellenv() {
    local brew_bin
    brew_bin="$(_brew_shellenv_path)"
    if [[ -n "$brew_bin" ]]; then
        eval "$("$brew_bin" shellenv)"
    fi
}

