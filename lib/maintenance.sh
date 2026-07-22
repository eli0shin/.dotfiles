# shellcheck shell=bash
# Diagnostics and supporting CLI commands.

cmd_update() {
    if [[ $# -gt 0 ]]; then
        error "Usage: dot update"
        return 1
    fi

    info "Updating dotfiles..."

    cd "$DOTFILES_DIR"

    git pull
    cmd_init

    success "Update complete"
}

cmd_doctor() {
    info "Running diagnostics..."
    local issues=0

    # Check Homebrew
    if has brew; then
        success "Homebrew: installed"
    else
        error "Homebrew: not installed"
        issues=$((issues + 1))
    fi

    # Check Stow
    if has stow; then
        success "GNU Stow: installed"
    else
        error "GNU Stow: not installed"
        issues=$((issues + 1))
    fi

    # Check Fish
    if has fish; then
        success "Fish shell: installed"
    else
        warn "Fish shell: not installed"
    fi

    # Check Neovim
    if has nvim; then
        success "Neovim: installed"
    else
        warn "Neovim: not installed"
    fi

    # Check tmux
    if has tmux; then
        success "tmux: installed"
    else
        warn "tmux: not installed"
    fi

    # Check symlinks
    info "Checking symlinks..."

    for link in "${SYMLINKS[@]}"; do
        if [[ -L "$link" ]]; then
            success "Symlink OK: $link"
        elif [[ -e "$link" ]]; then
            warn "Not a symlink: $link"
        else
            warn "Missing: $link"
        fi
    done

    # Check config merging
    info "Checking config merging..."
    local profile_file="$DOTFILES_DIR/.dotprofile"
    if [[ -f "$profile_file" ]]; then
        local profile
        profile=$(cat "$profile_file" | tr -d '[:space:]')
        if [[ "$profile" == "work" || "$profile" == "personal" ]]; then
            success "Profile: $profile"
        else
            warn "Invalid profile value: $profile (should be 'work' or 'personal')"
        fi
    else
        warn "No .dotprofile found (run 'echo work > $profile_file' or 'echo personal > $profile_file')"
    fi

    # Check for base files without generated output
    local base_files
    base_files=$(find "$DOTFILES_DIR/home" -name "*.base.json" -type f 2>/dev/null || true)
    if [[ -n "$base_files" ]]; then
        while IFS= read -r base_file; do
            local name="${base_file%.base.json}"
            if [[ -f "${name}.json" ]]; then
                success "Generated: ${name}.json"
            else
                warn "Missing generated: ${name}.json (run 'dot merge')"
                issues=$((issues + 1))
            fi
        done <<< "$base_files"
    fi

    if [[ $issues -eq 0 ]]; then
        success "All checks passed!"
    else
        error "$issues issue(s) found"
        return 1
    fi
}

cmd_edit() {
    local editor="${EDITOR:-nvim}"
    cd "$DOTFILES_DIR"
    $editor .
}

cmd_benchmark_shell() {
    info "Benchmarking Fish shell startup performance"

    if ! has fish; then
        error "Fish shell is not installed"
        info "Install Fish shell first: brew install fish"
        return 1
    fi

    local runs=10
    local verbose=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -r|--runs)
                if [[ $# -lt 2 || -z "${2:-}" ]]; then
                    error "Missing value for $1"
                    echo "Usage: dot benchmark-shell [-r RUNS] [-v]"
                    return 1
                fi
                runs="$2"
                shift 2
                ;;
            -v|--verbose) verbose=true; shift ;;
            -h|--help)
                echo "Usage: dot benchmark-shell [-r RUNS] [-v]"
                echo "  -r, --runs NUM   Number of benchmark runs (default: 10)"
                echo "  -v, --verbose    Show detailed timing for each run"
                return 0
                ;;
            *) error "Unknown option: $1"; return 1 ;;
        esac
    done

    if ! [[ "$runs" =~ ^[0-9]+$ ]] || [[ "$runs" -lt 1 ]] || [[ "$runs" -gt 100 ]]; then
        error "Number of runs must be between 1 and 100"
        return 1
    fi

    info "Running $runs Fish shell startup benchmarks..."

    local temp_script
    temp_script=$(mktemp -t dot_fish_benchmark_XXXXXX.fish)
    if [[ -z "$temp_script" ]]; then
        error "Failed to create temp file"
        return 1
    fi
    trap 'rm -f "$temp_script"; trap - RETURN' RETURN
    echo "exit 0" > "$temp_script"

    local times=()
    local total_time=0

    for i in $(seq 1 "$runs"); do
        [[ "$verbose" == true ]] && info "Run $i/$runs..."

        local elapsed
        if has python3; then
            if ! elapsed=$(python3 -c "
import time, subprocess, sys
start = time.time()
result = subprocess.run(['fish', '$temp_script'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if result.returncode != 0:
    sys.exit(result.returncode)
print(f'{time.time() - start:.3f}')
"); then
                error "Fish shell startup failed during benchmark run $i"
                return 1
            fi
        elif has perl; then
            if ! elapsed=$(perl -e "
use Time::HiRes 'time';
my \$start = time();
system('fish', '$temp_script');
exit(\$? >> 8) if \$? != 0;
printf '%.3f', time() - \$start;
"); then
                error "Fish shell startup failed during benchmark run $i"
                return 1
            fi
        else
            SECONDS=0
            if ! fish "$temp_script" >/dev/null 2>&1; then
                error "Fish shell startup failed during benchmark run $i"
                return 1
            fi
            elapsed="$SECONDS"
            [[ "$elapsed" == "0" ]] && elapsed="0.001"
        fi

        if [[ -z "$elapsed" ]] || ! [[ "$elapsed" =~ ^[0-9]*\.?[0-9]+$ ]]; then
            elapsed="0.001"
        fi

        times+=("$elapsed")
        total_time=$(echo "$total_time $elapsed" | awk '{printf "%.6f", $1 + $2}')

        [[ "$verbose" == true ]] && printf "  Run %2d: %.3f seconds\n" "$i" "$elapsed"
    done

    local avg_time min_time max_time range
    avg_time=$(echo "$total_time $runs" | awk '{printf "%.3f", $1/$2}')
    min_time="${times[0]}"
    max_time="${times[0]}"
    for t in "${times[@]}"; do
        [[ $(echo "$t $min_time" | awk '{print ($1 < $2)}') == 1 ]] && min_time="$t"
        [[ $(echo "$t $max_time" | awk '{print ($1 > $2)}') == 1 ]] && max_time="$t"
    done
    range=$(echo "$max_time $min_time" | awk '{printf "%.3f", $1 - $2}')

    echo ""
    echo -e "${BOLD}=== Fish Shell Startup Benchmark Results ===${NC}"
    echo ""
    echo -e "${BOLD}Configuration:${NC}"
    echo "  Shell: $(fish --version 2>/dev/null)"
    echo "  Runs:  $runs"
    echo "  Test:  Empty script execution"
    echo ""
    echo -e "${BOLD}Performance Results:${NC}"
    printf "  Average time: ${GREEN}%.3f${NC} seconds\n" "$avg_time"
    printf "  Fastest time: ${GREEN}%.3f${NC} seconds\n" "$min_time"
    printf "  Slowest time: ${YELLOW}%.3f${NC} seconds\n" "$max_time"
    printf "  Time range:   ${CYAN}%.3f${NC} seconds\n" "$range"
    echo ""
    echo -e "${BOLD}Performance Assessment:${NC}"
    if [[ $(echo "$avg_time 0.050" | awk '{print ($1 <= $2)}') == 1 ]]; then
        success "Excellent startup performance! (<=50ms)"
    elif [[ $(echo "$avg_time 0.100" | awk '{print ($1 <= $2)}') == 1 ]]; then
        success "Good startup performance (<=100ms)"
    elif [[ $(echo "$avg_time 0.200" | awk '{print ($1 <= $2)}') == 1 ]]; then
        warn "Fair startup performance (<=200ms)"
    else
        warn "Slow startup performance (>200ms)"
        echo ""
        info "Tips to improve Fish startup time:"
        info "  - Review config.fish for expensive operations"
        info "  - Lazy-load plugins and functions"
        info "  - Check for slow network calls in startup scripts"
    fi
    echo ""
    info "To profile in detail: fish --profile-startup /tmp/fish-startup.profile -ic exit"
    info "Then inspect: sort -nr /tmp/fish-startup.profile | head -20"
}

cmd_completions() {
    info "Generating Fish shell completions"

    local completions_dir="$HOME/.config/fish/completions"
    local completions_file="$completions_dir/dot.fish"

    if ! has fish; then
        error "Fish shell is not installed"
        info "Install Fish shell first: brew install fish"
        return 1
    fi

    if [[ ! -d "$completions_dir" ]]; then
        info "Creating Fish completions directory..."
        mkdir -p "$completions_dir"
    fi

    info "Generating completions file..."

    cat > "$completions_file" << 'EOF'
# Fish shell completions for the dot command
# Auto-generated by `dot completions`

complete -c dot -f

# Top-level commands
complete -c dot -n "__fish_use_subcommand" -a "init" -d "Full setup: brew, packages, stow, settings"
complete -c dot -n "__fish_use_subcommand" -a "stow" -d "Create symlinks with GNU Stow"
complete -c dot -n "__fish_use_subcommand" -a "unstow" -d "Remove symlinks"
complete -c dot -n "__fish_use_subcommand" -a "update" -d "Pull repo and run init"
complete -c dot -n "__fish_use_subcommand" -a "doctor" -d "Check installation health"
complete -c dot -n "__fish_use_subcommand" -a "edit" -d "Open dotfiles in editor"
complete -c dot -n "__fish_use_subcommand" -a "package" -d "Manage packages"
complete -c dot -n "__fish_use_subcommand" -a "merge" -d "Merge config files (*.base.json)"
complete -c dot -n "__fish_use_subcommand" -a "service" -d "Manage brew services"
complete -c dot -n "__fish_use_subcommand" -a "launch-agent" -d "Manage user LaunchAgents"
complete -c dot -n "__fish_use_subcommand" -a "pmset" -d "Manage power settings"
complete -c dot -n "__fish_use_subcommand" -a "defaults" -d "Manage macOS defaults"
complete -c dot -n "__fish_use_subcommand" -a "keyboard" -d "Manage keyboard remappings"
complete -c dot -n "__fish_use_subcommand" -a "backup" -d "Backup existing configs"
complete -c dot -n "__fish_use_subcommand" -a "restore" -d "Restore configs from backup"
complete -c dot -n "__fish_use_subcommand" -a "benchmark-shell" -d "Benchmark Fish startup performance"
complete -c dot -n "__fish_use_subcommand" -a "completions" -d "Generate Fish shell completions"
complete -c dot -n "__fish_use_subcommand" -a "link" -d "Install dot command globally"
complete -c dot -n "__fish_use_subcommand" -a "unlink" -d "Remove global dot command"
complete -c dot -n "__fish_use_subcommand" -a "help" -d "Show help message"

# stow options
complete -c dot -n "__fish_seen_subcommand_from stow" -s c -l clean -d "Remove dirs before stowing"

# package subcommands
complete -c dot -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from add remove install list" -a "add" -d "Add a package"
complete -c dot -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from add remove install list" -a "remove" -d "Remove a package"
complete -c dot -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from add remove install list" -a "install" -d "Install packages from profile"
complete -c dot -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from add remove install list" -a "list" -d "List all packages"

# package profile/type flags
complete -c dot -n "__fish_seen_subcommand_from package" -l personal -d "Target personal profile files"
complete -c dot -n "__fish_seen_subcommand_from package" -l work -d "Target work profile files"
complete -c dot -n "__fish_seen_subcommand_from package" -l npm -d "Target npm (Bun global) packages"

# service subcommands
complete -c dot -n "__fish_seen_subcommand_from service" -a "start" -d "Start services from services.json"
complete -c dot -n "__fish_seen_subcommand_from service" -a "list" -d "List configured and running services"

# launch-agent subcommands
complete -c dot -n "__fish_seen_subcommand_from launch-agent" -a "install" -d "Install and load LaunchAgents"
complete -c dot -n "__fish_seen_subcommand_from launch-agent" -a "unload" -d "Unload managed LaunchAgents"
complete -c dot -n "__fish_seen_subcommand_from launch-agent" -a "list" -d "List configured LaunchAgents"

# apply/show subcommands for settings commands
complete -c dot -n "__fish_seen_subcommand_from pmset" -a "apply show" -d "apply or show"
complete -c dot -n "__fish_seen_subcommand_from defaults" -a "apply show" -d "apply or show"
complete -c dot -n "__fish_seen_subcommand_from keyboard" -a "apply show" -d "apply or show"

# restore options
complete -c dot -n "__fish_seen_subcommand_from restore" -l list -d "List backup contents"
complete -c dot -n "__fish_seen_subcommand_from restore" -l merge -d "Restore only files not in repo"

# benchmark-shell options
complete -c dot -n "__fish_seen_subcommand_from benchmark-shell" -s r -l runs -d "Number of benchmark runs" -xa "5 10 15 20 25 30"
complete -c dot -n "__fish_seen_subcommand_from benchmark-shell" -s v -l verbose -d "Show detailed timing per run"

# Dynamic completion: installed brew packages (for package remove)
function __dot_installed_packages
    if command -q brew
        brew list --formula 2>/dev/null
        brew list --cask 2>/dev/null
    end
end
complete -c dot -n "__fish_seen_subcommand_from package; and __fish_seen_subcommand_from remove" -xa "(__dot_installed_packages)"
EOF

    if [[ -f "$completions_file" ]]; then
        success "Fish completions generated at $completions_file"
        info "Completions will be available in new Fish shell sessions"
        info "To reload now, run: source $completions_file"

        info "Testing completions..."
        if fish -c "complete -C 'dot '" >/dev/null 2>&1; then
            success "Completions are working correctly"
        else
            warn "Completions may need a shell restart to work properly"
        fi
    else
        error "Failed to generate completions file"
        return 1
    fi
}

cmd_link() {
    info "Installing dot command globally..."
    local link_path="$HOME/.local/bin/dot"

    mkdir -p "$HOME/.local/bin"

    if [[ -L "$link_path" ]]; then
        warn "Link already exists at $link_path"
    else
        ln -sf "$DOTFILES_DIR/dot" "$link_path"
        success "Linked dot to $link_path"
    fi
}

cmd_unlink() {
    info "Removing global dot command..."
    rm -f "$HOME/.local/bin/dot"
    success "Unlinked dot"
}

