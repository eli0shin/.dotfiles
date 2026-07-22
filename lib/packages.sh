# shellcheck shell=bash
# Package installation and manifest management.

BASH_PACKAGES_FILE="$PACKAGES_DIR/bash-packages.json"
BASH_PACKAGES_PERSONAL_FILE="$PACKAGES_DIR/bash-packages.personal.json"
BASH_PACKAGES_WORK_FILE="$PACKAGES_DIR/bash-packages.work.json"
NPM_PACKAGES_FILE="$PACKAGES_DIR/npm-packages"
NPM_PACKAGES_PERSONAL_FILE="$PACKAGES_DIR/npm-packages.personal"
NPM_PACKAGES_WORK_FILE="$PACKAGES_DIR/npm-packages.work"
BASH_PACKAGES_UNKNOWN_PLATFORM_WARNED=0

_ensure_package_managers() {
    # Homebrew may be installed even when the current shell has not loaded it.
    _load_brew_shellenv

    if ! has brew; then
        info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        _load_brew_shellenv
    else
        success "Homebrew already installed"
    fi

    if ! has stow; then
        info "Installing GNU Stow..."
        brew install stow
    else
        success "GNU Stow already installed"
    fi

    brew tap hashicorp/tap >/dev/null 2>&1 || true
    brew trust hashicorp/tap >/dev/null 2>&1 || true
}

_ensure_bash_packages_file() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        echo "[]" > "$file"
    fi
}

_bash_package_exists() {
    local pkg="$1"
    local file="$2"
    _ensure_bash_packages_file "$file"
    jq -e --arg cmd "$pkg" 'any(.[]; .command == $cmd)' "$file" >/dev/null 2>&1
}

_add_bash_package() {
    local pkg="$1"
    local install_script="$2"
    local file="$3"
    _ensure_bash_packages_file "$file"
    local tmp
    tmp=$(jq --arg cmd "$pkg" --arg inst "$install_script" \
        '. + [{"command": $cmd, "install": $inst}]' "$file")
    echo "$tmp" > "$file"
}

_remove_bash_package() {
    local pkg="$1"
    local file="$2"
    _ensure_bash_packages_file "$file"
    local tmp
    tmp=$(jq --arg cmd "$pkg" 'map(select(.command != $cmd))' "$file")
    echo "$tmp" > "$file"
}

_get_profile() {
    local profile_file="$DOTFILES_DIR/.dotprofile"
    if [[ -f "$profile_file" ]]; then
        cat "$profile_file" | tr -d '[:space:]'
    else
        echo ""
    fi
}

_ensure_npm_packages_file() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        touch "$file"
    fi
}

_npm_package_exists() {
    local pkg="$1"
    local file="$2"
    _ensure_npm_packages_file "$file"

    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        [[ "$line" == "$pkg" ]] && return 0
    done < "$file"

    return 1
}

_bun_global_package_exists() {
    local pkg="$1"
    local global_package_json="$HOME/.bun/install/global/package.json"

    [[ -f "$global_package_json" ]] || return 1
    jq -e --arg pkg "$pkg" '(.dependencies // {})[$pkg] != null' "$global_package_json" >/dev/null 2>&1
}

_add_npm_package() {
    local pkg="$1"
    local file="$2"
    _ensure_npm_packages_file "$file"
    printf '%s\n' "$pkg" >> "$file"
}

_remove_npm_package() {
    local pkg="$1"
    local file="$2"
    local tmp

    _ensure_npm_packages_file "$file"
    tmp=$(mktemp)

    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" == "$pkg" ]] && continue
        printf '%s\n' "$line" >> "$tmp"
    done < "$file"

    mv "$tmp" "$file"
}

_install_bash_packages() {
    info "Installing bash packages..."

    local profile
    profile=$(_get_profile)

    _process_bash_packages_file "$BASH_PACKAGES_FILE"

    if [[ "$profile" == "personal" && -f "$BASH_PACKAGES_PERSONAL_FILE" ]]; then
        _process_bash_packages_file "$BASH_PACKAGES_PERSONAL_FILE"
    elif [[ "$profile" == "work" && -f "$BASH_PACKAGES_WORK_FILE" ]]; then
        _process_bash_packages_file "$BASH_PACKAGES_WORK_FILE"
    fi
}

_install_npm_packages() {
    info "Installing npm registry packages with Bun..."

    if ! has bun; then
        warn "Bun is not installed, skipping npm registry packages"
        return 0
    fi

    local profile
    profile=$(_get_profile)

    _process_npm_packages_file "$NPM_PACKAGES_FILE"

    if [[ "$profile" == "personal" && -f "$NPM_PACKAGES_PERSONAL_FILE" ]]; then
        _process_npm_packages_file "$NPM_PACKAGES_PERSONAL_FILE"
    elif [[ "$profile" == "work" && -f "$NPM_PACKAGES_WORK_FILE" ]]; then
        _process_npm_packages_file "$NPM_PACKAGES_WORK_FILE"
    fi
}

_process_npm_packages_file() {
    local file="$1"
    local mode="${2:-install}"

    if [[ ! -f "$file" ]]; then
        return 0
    fi

    if ! grep -q '^[^#[:space:]]' "$file"; then
        return 0
    fi

    info "Processing $(basename "$file")..."

    while IFS= read -r pkg || [[ -n "$pkg" ]]; do
        [[ -z "$pkg" || "$pkg" == \#* ]] && continue

        if [[ "$mode" == "update" ]]; then
            info "Updating $pkg..."
            if bun update -g "$pkg"; then
                success "Updated $pkg"
            else
                warn "Failed to update $pkg (continuing...)"
            fi
        elif _bun_global_package_exists "$pkg"; then
            success "$pkg already installed"
        else
            info "Installing $pkg..."
            if bun add -g "$pkg"; then
                success "Installed $pkg"
            else
                warn "Failed to install $pkg (continuing...)"
            fi
        fi
    done < "$file"
}

_process_bash_packages_file() {
    local file="$1"

    if [[ ! -f "$file" ]]; then
        return 0
    fi

    local count
    count=$(jq 'length' "$file")

    if [[ "$count" -eq 0 ]]; then
        return 0
    fi

    info "Processing $(basename "$file")..."

    local platform
    platform="$(_current_platform)"
    if [[ -z "$platform" && "$BASH_PACKAGES_UNKNOWN_PLATFORM_WARNED" -eq 0 ]]; then
        warn "Unsupported platform; using top-level bash package commands only"
        BASH_PACKAGES_UNKNOWN_PLATFORM_WARNED=1
    fi

    local packages
    packages=$(jq -c '.[]' "$file")

    while IFS= read -r pkg_json; do
        local cmd install_script update_cmd check_cmd
        cmd=$(echo "$pkg_json" | jq -r '.command')
        install_script=$(echo "$pkg_json" | jq -r --arg platform "$platform" '(.platforms[$platform].install | select(. != "")) // .install // empty')
        update_cmd=$(echo "$pkg_json" | jq -r --arg platform "$platform" '(.platforms[$platform].update | select(. != "")) // .update // empty')
        check_cmd=$(echo "$pkg_json" | jq -r '.check // empty')

        if { [[ -n "$check_cmd" ]] && eval "$check_cmd"; } || { [[ -z "$check_cmd" ]] && has "$cmd"; }; then
            if [[ -n "$update_cmd" ]]; then
                info "Updating $cmd..."
                if eval "$update_cmd"; then
                    success "Updated $cmd"
                else
                    warn "Failed to update $cmd (continuing...)"
                fi
            else
                success "$cmd already installed"
            fi
        else
            if [[ -z "$install_script" ]]; then
                warn "No install command for $cmd on ${platform:-this platform} (continuing...)"
                continue
            fi
            info "Installing $cmd..."
            if eval "$install_script"; then
                success "Installed $cmd"
            else
                warn "Failed to install $cmd (continuing...)"
            fi
        fi
    done <<< "$packages"
}

cmd_package() {
    local subcmd="${1:-}"
    shift || true

    # Parse --personal and --work flags
    local personal=false
    local work=false
    local npm=false
    local args=()
    for arg in "$@"; do
        case "$arg" in
            --personal) personal=true ;;
            --work) work=true ;;
            --npm) npm=true ;;
            *) args+=("$arg") ;;
        esac
    done

    local brewfile bash_pkg_file npm_pkg_file
    if [[ "$personal" == true ]]; then
        brewfile="$PACKAGES_DIR/Brewfile.personal"
        bash_pkg_file="$BASH_PACKAGES_PERSONAL_FILE"
        npm_pkg_file="$NPM_PACKAGES_PERSONAL_FILE"
    elif [[ "$work" == true ]]; then
        brewfile="$PACKAGES_DIR/Brewfile.work"
        bash_pkg_file="$BASH_PACKAGES_WORK_FILE"
        npm_pkg_file="$NPM_PACKAGES_WORK_FILE"
    else
        brewfile="$PACKAGES_DIR/Brewfile"
        bash_pkg_file="$BASH_PACKAGES_FILE"
        npm_pkg_file="$NPM_PACKAGES_FILE"
    fi

    case "$subcmd" in
        add)
            local pkg="${args[0]:-}"
            local install_script="${args[1]:-}"

            if [[ -z "$pkg" ]]; then
                error "Usage: dot package add <package> [--personal|--work]"
                error "       dot package add <package> --npm [--personal|--work]"
                error "       dot package add <name> \"<install-script>\" [--personal|--work]"
                return 1
            fi

            if [[ "$npm" == true ]]; then
                _ensure_npm_packages_file "$npm_pkg_file"

                if _npm_package_exists "$pkg" "$npm_pkg_file"; then
                    error "Package '$pkg' already exists in $(basename "$npm_pkg_file")"
                    return 1
                fi

                info "Adding npm registry package '$pkg' to $(basename "$npm_pkg_file")..."
                _add_npm_package "$pkg" "$npm_pkg_file"

                if has bun; then
                    if _bun_global_package_exists "$pkg"; then
                        success "$pkg is already installed"
                    else
                        info "Installing $pkg with Bun..."
                        bun add -g "$pkg" || warn "Installation may have failed"
                    fi
                else
                    warn "Bun is not installed, package was added but not installed"
                fi

                success "Added npm registry package: $pkg"
            elif [[ -n "$install_script" ]]; then
                _ensure_bash_packages_file "$bash_pkg_file"

                if _bash_package_exists "$pkg" "$bash_pkg_file"; then
                    error "Package '$pkg' already exists in $(basename "$bash_pkg_file")"
                    return 1
                fi

                info "Adding bash package '$pkg' to $(basename "$bash_pkg_file")..."
                _add_bash_package "$pkg" "$install_script" "$bash_pkg_file"

                if ! has "$pkg"; then
                    info "Installing $pkg..."
                    eval "$install_script" || warn "Installation may have failed"
                else
                    success "$pkg is already installed"
                fi
                success "Added bash package: $pkg"
            else
                # Brew package (existing behavior)
                local pkg_type="brew"
                if brew info --cask "$pkg" &>/dev/null; then
                    pkg_type="cask"
                fi

                info "Adding $pkg ($pkg_type) to $(basename "$brewfile")..."
                echo "$pkg_type \"$pkg\"" >> "$brewfile"

                if [[ "$pkg_type" == "cask" ]]; then
                    brew install --cask "$pkg"
                else
                    brew install "$pkg"
                fi
                success "Added $pkg"
            fi
            ;;
        remove)
            local pkg="${args[0]:-}"
            if [[ -z "$pkg" ]]; then
                error "Usage: dot package remove <package> [--personal|--work]"
                return 1
            fi

            if [[ "$npm" == true ]]; then
                if _npm_package_exists "$pkg" "$npm_pkg_file"; then
                    info "Removing npm registry package '$pkg' from $(basename "$npm_pkg_file")..."
                    _remove_npm_package "$pkg" "$npm_pkg_file"

                    if has bun; then
                        bun remove -g "$pkg" 2>/dev/null || warn "Package not installed globally by Bun"
                    else
                        warn "Bun is not installed, skipping uninstall"
                    fi

                    success "Removed npm registry package: $pkg"
                else
                    error "Package '$pkg' not found in $(basename "$npm_pkg_file")"
                    return 1
                fi
            elif _npm_package_exists "$pkg" "$NPM_PACKAGES_FILE"; then
                info "Removing npm registry package '$pkg' from npm-packages..."
                _remove_npm_package "$pkg" "$NPM_PACKAGES_FILE"
                if has bun; then
                    bun remove -g "$pkg" 2>/dev/null || warn "Package not installed globally by Bun"
                else
                    warn "Bun is not installed, skipping uninstall"
                fi
                success "Removed npm registry package: $pkg"
            elif _npm_package_exists "$pkg" "$NPM_PACKAGES_PERSONAL_FILE"; then
                info "Removing npm registry package '$pkg' from npm-packages.personal..."
                _remove_npm_package "$pkg" "$NPM_PACKAGES_PERSONAL_FILE"
                if has bun; then
                    bun remove -g "$pkg" 2>/dev/null || warn "Package not installed globally by Bun"
                else
                    warn "Bun is not installed, skipping uninstall"
                fi
                success "Removed npm registry package: $pkg"
            elif _npm_package_exists "$pkg" "$NPM_PACKAGES_WORK_FILE"; then
                info "Removing npm registry package '$pkg' from npm-packages.work..."
                _remove_npm_package "$pkg" "$NPM_PACKAGES_WORK_FILE"
                if has bun; then
                    bun remove -g "$pkg" 2>/dev/null || warn "Package not installed globally by Bun"
                else
                    warn "Bun is not installed, skipping uninstall"
                fi
                success "Removed npm registry package: $pkg"
            elif _bash_package_exists "$pkg" "$BASH_PACKAGES_FILE"; then
                info "Removing bash package '$pkg' from bash-packages.json..."
                _remove_bash_package "$pkg" "$BASH_PACKAGES_FILE"
                success "Removed bash package: $pkg"
                info "Note: The command '$pkg' remains installed on your system"
            elif _bash_package_exists "$pkg" "$BASH_PACKAGES_PERSONAL_FILE"; then
                info "Removing bash package '$pkg' from bash-packages.personal.json..."
                _remove_bash_package "$pkg" "$BASH_PACKAGES_PERSONAL_FILE"
                success "Removed bash package: $pkg"
                info "Note: The command '$pkg' remains installed on your system"
            elif _bash_package_exists "$pkg" "$BASH_PACKAGES_WORK_FILE"; then
                info "Removing bash package '$pkg' from bash-packages.work.json..."
                _remove_bash_package "$pkg" "$BASH_PACKAGES_WORK_FILE"
                success "Removed bash package: $pkg"
                info "Note: The command '$pkg' remains installed on your system"
            else
                # Brew package removal
                info "Removing $pkg from $(basename "$brewfile")..."
                sed -i '' "/\"$pkg\"/d" "$brewfile"
                brew uninstall "$pkg" 2>/dev/null || brew uninstall --cask "$pkg" 2>/dev/null || warn "Package not installed"
                success "Removed $pkg"
            fi
            ;;
        install)
            _ensure_package_managers

            local profile
            profile=$(_get_profile)

            # Always install base packages
            info "Installing from Brewfile..."
            brew bundle --file="$PACKAGES_DIR/Brewfile" || warn "Some Brewfile packages failed to install"

            # Install profile-specific brew packages
            if [[ "$profile" == "personal" && -f "$PACKAGES_DIR/Brewfile.personal" ]]; then
                info "Installing from Brewfile.personal..."
                brew bundle --file="$PACKAGES_DIR/Brewfile.personal" || warn "Some personal Brewfile packages failed to install"
            elif [[ "$profile" == "work" && -f "$PACKAGES_DIR/Brewfile.work" ]]; then
                info "Installing from Brewfile.work..."
                brew bundle --file="$PACKAGES_DIR/Brewfile.work" || warn "Some work Brewfile packages failed to install"
            fi

            echo ""
            _install_bash_packages

            echo ""
            _install_npm_packages

            success "Installation complete"
            ;;
        list)
            echo -e "${BLUE}=== Brew Packages ===${NC}"
            if [[ -f "$brewfile" ]]; then
                cat "$brewfile"
            else
                echo "(none)"
            fi

            echo ""
            echo -e "${BLUE}=== Bash Packages ===${NC}"
            _ensure_bash_packages_file "$BASH_PACKAGES_FILE"

            local has_packages=false

            if [[ -f "$BASH_PACKAGES_FILE" ]]; then
                local count
                count=$(jq 'length' "$BASH_PACKAGES_FILE")
                if [[ "$count" -gt 0 ]]; then
                    has_packages=true
                    echo "Core (bash-packages.json):"
                    jq -r '.[] | "  \(.command): \(.install)"' "$BASH_PACKAGES_FILE"
                fi
            fi

            if [[ -f "$BASH_PACKAGES_PERSONAL_FILE" ]]; then
                local count
                count=$(jq 'length' "$BASH_PACKAGES_PERSONAL_FILE")
                if [[ "$count" -gt 0 ]]; then
                    has_packages=true
                    echo "Personal (bash-packages.personal.json):"
                    jq -r '.[] | "  \(.command): \(.install)"' "$BASH_PACKAGES_PERSONAL_FILE"
                fi
            fi

            if [[ -f "$BASH_PACKAGES_WORK_FILE" ]]; then
                local count
                count=$(jq 'length' "$BASH_PACKAGES_WORK_FILE")
                if [[ "$count" -gt 0 ]]; then
                    has_packages=true
                    echo "Work (bash-packages.work.json):"
                    jq -r '.[] | "  \(.command): \(.install)"' "$BASH_PACKAGES_WORK_FILE"
                fi
            fi

            if [[ "$has_packages" == false ]]; then
                echo "(none)"
            fi

            echo ""
            echo -e "${BLUE}=== NPM Registry Packages (Bun global) ===${NC}"
            _ensure_npm_packages_file "$NPM_PACKAGES_FILE"

            local has_npm_packages=false

            if [[ -f "$NPM_PACKAGES_FILE" ]] && grep -q '^[^#[:space:]]' "$NPM_PACKAGES_FILE"; then
                has_npm_packages=true
                echo "Core (npm-packages):"
                while IFS= read -r pkg || [[ -n "$pkg" ]]; do
                    [[ -z "$pkg" || "$pkg" == \#* ]] && continue
                    echo "  $pkg"
                done < "$NPM_PACKAGES_FILE"
            fi

            if [[ -f "$NPM_PACKAGES_PERSONAL_FILE" ]] && grep -q '^[^#[:space:]]' "$NPM_PACKAGES_PERSONAL_FILE"; then
                has_npm_packages=true
                echo "Personal (npm-packages.personal):"
                while IFS= read -r pkg || [[ -n "$pkg" ]]; do
                    [[ -z "$pkg" || "$pkg" == \#* ]] && continue
                    echo "  $pkg"
                done < "$NPM_PACKAGES_PERSONAL_FILE"
            fi

            if [[ -f "$NPM_PACKAGES_WORK_FILE" ]] && grep -q '^[^#[:space:]]' "$NPM_PACKAGES_WORK_FILE"; then
                has_npm_packages=true
                echo "Work (npm-packages.work):"
                while IFS= read -r pkg || [[ -n "$pkg" ]]; do
                    [[ -z "$pkg" || "$pkg" == \#* ]] && continue
                    echo "  $pkg"
                done < "$NPM_PACKAGES_WORK_FILE"
            fi

            if [[ "$has_npm_packages" == false ]]; then
                echo "(none)"
            fi
            ;;
        *)
            error "Usage: dot package <add|remove|install|list> [package] [--personal|--work] [--npm]"
            return 1
            ;;
    esac
}

