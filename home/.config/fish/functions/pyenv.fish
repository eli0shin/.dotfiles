function pyenv --description "Lazy-load pyenv on first use"
    functions --erase pyenv
    functions --erase python
    functions --erase python3
    command pyenv init --path | source
    command pyenv init - | source
    command pyenv $argv
end
