function spawn-worker --description "Create a Pi worker for one Tickets ticket"
    if test (count $argv) -ne 1; and test (count $argv) -ne 3
        echo "Usage: spawn-worker <ticket-name> [--context <text>]" >&2
        return 2
    end
    if test (count $argv) -eq 3; and test "$argv[2]" != "--context"
        echo "Usage: spawn-worker <ticket-name> [--context <text>]" >&2
        return 2
    end

    set -l context
    if test (count $argv) -eq 3
        set context (string trim -- "$argv[3]" | string collect)
    else if not test -t 0
        read -z context
        set context (string trim -- "$context" | string collect)
    end
    if not set -q PI_ORCHESTRATION_SESSION_ID; or test -z "$PI_ORCHESTRATION_SESSION_ID"
        echo "spawn-worker requires PI_ORCHESTRATION_SESSION_ID" >&2
        return 2
    end
    set -l landing_branch (command git branch --show-current 2>/dev/null)
    if test $status -ne 0; or test -z "$landing_branch"
        echo "spawn-worker requires a named current Git branch" >&2
        return 2
    end

    set -l upstream (command git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)
    set -l upstream_status $status
    set -l upstream_parts (string split -m 1 / -- $upstream)
    if test $upstream_status -ne 0; or test (count $upstream_parts) -ne 2; or test "$upstream_parts[2]" != "$landing_branch"
        echo "spawn-worker requires landing branch $landing_branch to track a same-named remote branch" >&2
        return 2
    end

    set -l head_sha (command git rev-parse HEAD 2>/dev/null); or return
    set -l upstream_sha (command git rev-parse '@{upstream}' 2>/dev/null); or return
    if test "$head_sha" != "$upstream_sha"
        echo "spawn-worker requires landing branch $landing_branch to exactly match its upstream" >&2
        return 2
    end

    set -l ticket $argv[1]
    tickets show $ticket; or return

    set -l sessions_before (tmux list-sessions -F '#{session_name}' 2>/dev/null)

    repos stack --no-focus $ticket; or return

    set -l sessions_after (tmux list-sessions -F '#{session_name}' 2>/dev/null)
    set -l new_sessions
    for session in $sessions_after
        if not contains -- $session $sessions_before
            set -a new_sessions $session
        end
    end
    if test (count $new_sessions) -ne 1
        echo "repos did not create exactly one new worker session for $ticket" >&2
        return 1
    end
    set -l session $new_sessions[1]

    set -l prompt_lines \
        '/skill:ticket-worker' \
        '' \
        "Ticket: $ticket" \
        "Worker identity: $session" \
        "PR base: $landing_branch" \
        "PR marker: <!-- pi-orchestration-run: $PI_ORCHESTRATION_SESSION_ID -->"
    if test -n "$context"
        set -a prompt_lines '' 'Context:' "$context"
    end
    set -l prompt (string join \n $prompt_lines | string collect)

    tmux send-keys -l -t "$session:0" -- "env -u PI_ORCHESTRATION_SESSION_ID pi"; or return
    tmux send-keys -t "$session:0" C-m; or return
    tmux send-keys -l -t "$session:0" -- $prompt; or return
    tmux send-keys -t "$session:0" C-m
end
