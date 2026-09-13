function dcl
    if test (count $argv) -ne 0
        echo "Usage: dcl" >&2
        return 1
    end

    nvim +DiffReviewCommentList
end
