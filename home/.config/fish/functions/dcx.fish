function dcx
    if test (count $argv) -ne 0
        echo "Usage: dcx" >&2
        return 1
    end

    nvim --headless +DiffReviewCommentCut +qa
end
