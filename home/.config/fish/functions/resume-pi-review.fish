function resume-pi-review --description "Resume a Pi code review session"
    pi --session-dir ~/.pi/agent/code-review-sessions --resume $argv
end
