function pr
    if test (count $argv) -gt 1
        echo "Usage: pr [number|url|branch]" >&2
        return 1
    end

    if not git rev-parse --is-inside-work-tree >/dev/null 2>&1
        echo "pr: not inside a Git repository" >&2
        return 1
    end

    set -l pr_info (gh pr view $argv --json number,baseRefName,url --jq '.number, .baseRefName, .url' 2>&1)
    set -l gh_status $status
    if test $gh_status -ne 0
        string join \n -- $pr_info >&2
        return $gh_status
    end

    if test (count $pr_info) -ne 3
        echo "pr: could not read pull request details" >&2
        return 1
    end

    set -l number $pr_info[1]
    set -l base_branch $pr_info[2]
    set -l repo_url (string replace -r '/pull/[0-9]+/?$' '.git' $pr_info[3])
    set -l base_ref "refs/diffview/pull/$number/base"
    set -l head_ref "refs/diffview/pull/$number/head"

    git fetch --quiet $repo_url \
        "+refs/heads/$base_branch:$base_ref" \
        "+refs/pull/$number/head:$head_ref"
    or return $status

    set -lx PR_DIFF_NUMBER $number
    set -lx PR_DIFF_URL $pr_info[3]
    set -lx PR_DIFF_REPO_URL $repo_url
    set -lx PR_DIFF_BASE_BRANCH $base_branch
    set -lx PR_DIFF_BASE_REF $base_ref
    set -lx PR_DIFF_HEAD_REF $head_ref

    nvim "+lua require('pr_diff').open()"
end
