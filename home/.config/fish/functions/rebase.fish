function rebase
    # Check if a branch name was provided
    if test (count $argv) -eq 0
        echo "Usage: rebase <branch>"
        return 1
    end

    # Fetch and rebase onto remote branch
    echo "Rebasing onto origin/$argv[1]..."
    git fetch origin $argv[1] && git rebase -i origin/$argv[1]
end
