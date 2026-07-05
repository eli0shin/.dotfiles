function python --description "Trigger pyenv lazy-load then run python"
    pyenv --version >/dev/null # triggers lazy init which erases this function

    if command -q python
        command python $argv
    else
        command python3 $argv
    end
end
