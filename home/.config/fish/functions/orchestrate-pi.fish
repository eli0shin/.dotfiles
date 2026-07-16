function orchestrate-pi --description "Start Pi with a new orchestration session ID"
    set -lx PI_ORCHESTRATION_SESSION_ID (uuidgen); or return
    exec pi $argv
end
