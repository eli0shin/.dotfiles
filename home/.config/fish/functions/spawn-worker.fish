function spawn-worker --description "Create a Pi worker for one Tickets ticket"
    if test (count $argv) -ne 1
        echo "Usage: spawn-worker <ticket-name>" >&2
        return 2
    end
    if not set -q PI_ORCHESTRATION_SESSION_ID; or test -z "$PI_ORCHESTRATION_SESSION_ID"
        echo "spawn-worker requires PI_ORCHESTRATION_SESSION_ID" >&2
        return 2
    end

    set -l ticket $argv[1]
    tickets show $ticket; or return

    set -l sessions_before (tmux list-sessions -F '#{session_name}' 2>/dev/null)

    repos work $ticket; or return

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

    set -l prompt (string join \n \
        '/skill:ticket-worker' \
        '' \
        "Ticket: $ticket" \
        "Worker identity: $session" \
        "PR marker: <!-- pi-orchestration-run: $PI_ORCHESTRATION_SESSION_ID -->" | string collect)

    tmux send-keys -l -t "$session:0" -- "env -u PI_ORCHESTRATION_SESSION_ID pi"; or return
    tmux send-keys -t "$session:0" C-m; or return
    tmux send-keys -l -t "$session:0" -- $prompt; or return
    tmux send-keys -t "$session:0" C-m
end
