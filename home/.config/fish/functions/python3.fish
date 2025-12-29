function python3 --description "Trigger pyenv lazy-load then run python3"
    pyenv # triggers lazy init which erases this function
    command python3 $argv
end
