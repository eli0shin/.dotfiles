function resume-pi-review --description "Resume a Pi code review session"
    exec pi --session-dir ~/.pi/agent/code-review-sessions --resume $argv
end
