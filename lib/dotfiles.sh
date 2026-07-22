# shellcheck shell=bash
# Stowing, config merging, and backup management.

_install_git_hooks() {
    local hooks_dir="$DOTFILES_DIR/.git/hooks"
    local hook_script="$SCRIPTS_DIR/git-hook-merge.sh"

    for hook in post-checkout post-merge; do
        local hook_path="$hooks_dir/$hook"
        if [[ ! -L "$hook_path" ]] || [[ "$(readlink "$hook_path")" != "$hook_script" ]]; then
            ln -sf "$hook_script" "$hook_path"
            info "Installed $hook hook"
        fi
    done
}

_install_omf_bundle() {
    if ! has fish; then
        return 0
    fi

    if [[ ! -f "$HOME/.config/omf/bundle" ]]; then
        return 0
    fi

    info "Installing Oh My Fish bundle..."
    if fish -lc 'type -q omf; and omf install'; then
        success "Installed Oh My Fish bundle"
    else
        warn "Failed to install Oh My Fish bundle"
    fi
}

cmd_stow() {
    local clean=false
    [[ "${1:-}" == "--clean" || "${1:-}" == "-c" ]] && clean=true

    info "Stowing dotfiles..."

    cd "$DOTFILES_DIR"

    # Merge configs before stowing
    cmd_merge 2>/dev/null || true

    # Remove nested .git directories (excluding marketplaces)
    _clean_nested_git

    if [[ "$clean" == true ]]; then
        info "Clean mode: removing managed directories..."
        for path in "${SYMLINKS[@]}"; do
            if [[ -e "$path" && ! -L "$path" ]]; then
                rm -rf "$path"
                info "Removed: $path"
            fi
        done
    fi

    # Create directory symlinks from $HOME to dotfiles
    stow -v --target="$HOME" --dir="$DOTFILES_DIR" home

    success "Dotfiles stowed successfully"
}

_clean_nested_git() {
    # Remove .git directories only at the root of stow-managed directories
    for link in "${SYMLINKS[@]}"; do
        local rel_path="${link#$HOME/}"
        local git_dir="$DOTFILES_DIR/home/$rel_path/.git"
        if [[ -d "$git_dir" ]]; then
            rm -rf "$git_dir"
            info "Removed nested .git: home/$rel_path/.git"
        fi
    done
}

cmd_unstow() {
    info "Unstowing dotfiles..."
    cd "$DOTFILES_DIR"
    stow -v --delete --target="$HOME" --dir="$DOTFILES_DIR" home
    success "Dotfiles unstowed"
}

cmd_merge() {
    info "Merging config files..."

    local profile_file="$DOTFILES_DIR/.dotprofile"

    # Check profile exists
    if [[ ! -f "$profile_file" ]]; then
        warn "No profile set. Create $profile_file with 'work' or 'personal'"
    else
        info "Profile: $(cat "$profile_file")"
    fi

    # Find all *.base.json files in home/ and settings/
    local base_files
    base_files=$(find "$DOTFILES_DIR/home" "$SETTINGS_DIR" -name "*.base.json" -type f 2>/dev/null || true)

    if [[ -z "$base_files" ]]; then
        info "No config files to merge (no *.base.json files found)"
        return 0
    fi

    local count=0
    local errors=0

    while IFS= read -r base_file; do
        if "$SCRIPTS_DIR/merge-config.sh" "$base_file"; then
            count=$((count + 1))
        else
            errors=$((errors + 1))
        fi
    done <<< "$base_files"

    if [[ $errors -eq 0 ]]; then
        success "Merged $count config file(s)"
    else
        error "Completed with $errors error(s)"
        return 1
    fi
}

cmd_backup() {
    info "Backing up existing configs to $BACKUP_DIR..."

    mkdir -p "$BACKUP_DIR"

    local backed_up=0

    for path in "${SYMLINKS[@]}"; do
        if [[ -L "$path" ]]; then
            # Already a symlink (managed by stow), skip
            info "Skipping $path (already a symlink)"
        elif [[ -e "$path" ]]; then
            # Real file/directory exists, back it up
            local rel_path="${path#$HOME/}"
            local backup_path="$BACKUP_DIR/$rel_path"
            local backup_parent
            backup_parent=$(dirname "$backup_path")

            mkdir -p "$backup_parent"
            rm -rf "$backup_path"  # Remove old backup if exists
            cp -a "$path" "$backup_path"
            success "Backed up: $path"
            backed_up=$((backed_up + 1))
        else
            info "Skipping $path (does not exist)"
        fi
    done

    if [[ $backed_up -eq 0 ]]; then
        info "Nothing to backup (all paths are symlinks or don't exist)"
    else
        success "Backed up $backed_up directory(ies) to $BACKUP_DIR"
    fi
}

cmd_restore() {
    if [[ "${1:-}" == "--list" ]]; then
        info "Backup contents in $BACKUP_DIR:"
        if [[ -d "$BACKUP_DIR" ]]; then
            find "$BACKUP_DIR" -mindepth 1 -maxdepth 2 -type d | while read -r dir; do
                echo "  ${dir#$BACKUP_DIR/}"
            done
        else
            warn "No backup directory found"
        fi
        return 0
    fi

    if [[ ! -d "$BACKUP_DIR" ]]; then
        error "No backup found at $BACKUP_DIR"
        error "Run 'dot backup' first to create a backup"
        return 1
    fi

    if [[ "${1:-}" == "--merge" ]]; then
        info "Merging extra files from backup (skipping files in dotfiles repo)..."
        local merged=0

        # Find all files in backup
        while IFS= read -r -d '' backup_file; do
            local rel_path="${backup_file#$BACKUP_DIR/}"
            local repo_file="$DOTFILES_DIR/home/$rel_path"
            local target_file="$HOME/$rel_path"

            # Only copy if file doesn't exist in dotfiles repo
            if [[ ! -e "$repo_file" ]]; then
                local target_dir
                target_dir=$(dirname "$target_file")
                mkdir -p "$target_dir"
                cp -a "$backup_file" "$target_file"
                info "Restored: $rel_path"
                merged=$((merged + 1))
            fi
        done < <(find "$BACKUP_DIR" -type f \
            -not -path "*/node_modules/*" \
            -not -path "*/.git/*" \
            -print0)

        if [[ $merged -eq 0 ]]; then
            info "No extra files to restore"
        else
            success "Restored $merged extra file(s)"
        fi
        return 0
    fi

    info "Restoring configs from $BACKUP_DIR..."

    # Unstow first to remove symlinks
    cmd_unstow 2>/dev/null || true

    local restored=0

    for path in "${SYMLINKS[@]}"; do
        local rel_path="${path#$HOME/}"
        local backup_path="$BACKUP_DIR/$rel_path"

        if [[ -e "$backup_path" ]]; then
            rm -rf "$path"  # Remove existing (symlink or dir)
            cp -a "$backup_path" "$path"
            success "Restored: $path"
            restored=$((restored + 1))
        fi
    done

    if [[ $restored -eq 0 ]]; then
        warn "No matching backups found to restore"
    else
        success "Restored $restored directory(ies)"
    fi
}

