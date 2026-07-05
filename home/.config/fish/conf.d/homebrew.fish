# Make Homebrew packages available in Fish on both macOS and Linuxbrew hosts.
for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew
    if test -x $brew_bin
        eval ($brew_bin shellenv)
        break
    end
end
