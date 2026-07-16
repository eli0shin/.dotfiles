function setup-orchestration-repo --description "Ensure a repository has the Pi orchestration label"
    if test (count $argv) -ne 1
        echo "Usage: setup-orchestration-repo <repo-url>" >&2
        return 2
    end

    set -l repo (gh repo view $argv[1] --json nameWithOwner --jq .nameWithOwner); or return

    gh label create pi-orchestrated \
        --repo $repo \
        --force \
        --color 8250df \
        --description "Pull request created by a Pi orchestration worker"
end
