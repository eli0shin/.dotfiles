function orchestrate-opencode --description "Start OpenCode with a new orchestration session ID"
    set -l orchestration_id (uuidgen); or return
    set -lx OPENCODE_ORCHESTRATION_SESSION_ID $orchestration_id
    set -lx PI_ORCHESTRATION_SESSION_ID $orchestration_id
    exec opencode2 $argv
end
