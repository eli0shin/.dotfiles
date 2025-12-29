function feature
    # Check if a branch name was provided
    if test (count $argv) -eq 0
        echo "Usage: feature <branch>"
        return 1
    end

    git worktree add $argv[1] feature/$argv[1]
    cd $argv[1]
end
