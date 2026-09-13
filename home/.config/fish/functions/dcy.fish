function dcy
    if test (count $argv) -ne 0
        echo "Usage: dcy" >&2
        return 1
    end

    nvim --headless +DiffReviewCommentYank +qa
end
