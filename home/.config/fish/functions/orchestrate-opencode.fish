function orchestrate-opencode --description "Start OpenCode with a new orchestration session ID"
    set -l orchestration_id (uuidgen); or return
    set -e PI_ORCHESTRATION_SESSION_ID
    set -e PI_PARENT_ORCHESTRATION_SESSION_ID
    set -lx OPENCODE_ORCHESTRATION_SESSION_ID $orchestration_id
    exec opencode --standalone $argv
end
