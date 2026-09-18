function orchestrate-pi --description "Start Pi with a new orchestration session ID"
    set -l orchestration_id (uuidgen); or return
    set -e OPENCODE_ORCHESTRATION_SESSION_ID
    set -e OPENCODE_PARENT_ORCHESTRATION_SESSION_ID
    set -lx PI_ORCHESTRATION_SESSION_ID $orchestration_id
    pi $argv
end
