function __diff_review_pr_url --description "Print the GitHub PR URL for a PR number in the current repo's origin"
    set -l number $argv[1]
    if not string match -qr '^[0-9]+$' -- "$number"
        echo "expected a PR number, got: $number" >&2
        return 1
    end

    set -l remote (git remote get-url origin 2>/dev/null)
    or begin
        echo "no origin remote" >&2
        return 1
    end

    set -l slug (string replace -r '\.git$' '' -- $remote | string match -r '[:/]([^/:]+/[^/]+)$')[2]
    if test -z "$slug"
        echo "could not parse origin remote: $remote" >&2
        return 1
    end

    echo "https://github.com/$slug/pull/$number"
end
