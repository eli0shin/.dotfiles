function pyenv --description "Lazy-load pyenv on first use"
    functions --erase pyenv
    functions --erase python
    functions --erase python3
    eval (command pyenv init --path)
    eval (command pyenv init -)
    command pyenv $argv
end
