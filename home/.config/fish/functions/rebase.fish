function rebase
    # Check if a branch name was provided
    if test (count $argv) -eq 0
        echo "Usage: rebase <branch>"
        return 1
    end

    # Perform git rebase
    echo "Rebasing onto branch '$argv[1]'..."
    git stash && git checkout $argv[1] && git pull && git checkout - && git rebase -i $argv[1]
end
