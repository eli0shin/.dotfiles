function python --description "Trigger pyenv lazy-load then run python"
    pyenv # triggers lazy init which erases this function
    command python $argv
end
