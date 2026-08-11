function devbox
    argparse --exclusive h,t h t -- $argv
    or return

    set -l command herdr
    if set -q _flag_t
        set command t
    end

    mosh elioshinsky@devbox.home.arpa -- fish -ic $command
end
