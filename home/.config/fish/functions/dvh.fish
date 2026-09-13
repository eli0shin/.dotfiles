function dvh
    set -l single_quote "'"
    set -l escaped_single_quote "'\"'\"'"
    set -l quoted_args

    for arg in $argv
        set -l escaped_arg (string replace -a -- $single_quote $escaped_single_quote $arg)
        set -a quoted_args "$single_quote$escaped_arg$single_quote"
    end

    set -l command (string join ' ' -- DiffviewFileHistory $quoted_args)
    nvim "+$command"
end
