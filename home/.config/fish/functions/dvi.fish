function dvi
    if test (count $argv) -ne 1
        echo "Usage: dvi <git-reference>" >&2
        return 1
    end

    nvim "+DiffviewOpen $argv[1]"
end
