function dcx
    if test (count $argv) -gt 1
        echo "Usage: dcx [pr-number]" >&2
        return 1
    end

    if test (count $argv) -eq 1
        set -fx PR_DIFF_URL (__diff_review_pr_url $argv[1])
        or return 1
    end

    nvim --headless +DiffReviewCommentCut +qa
end
