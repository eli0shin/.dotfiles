function work-herdr --description 'Attach to the Mac Herdr session shared to this host'
    if test (count $argv) -gt 0
        echo 'usage: work-herdr (run on the host receiving herdr-share)' >&2
        return 2
    end

    set -l socket "$HOME/.cache/herdr-work/current/herdr.sock"
    set -l client_socket "$HOME/.cache/herdr-work/current/herdr-client.sock"
    if not test -S "$socket"; or not test -S "$client_socket"
        echo 'work-herdr: no shared session. Run herdr-share on your Mac first.' >&2
        return 1
    end

    # Client-only mode never starts a local server if the tunnel is down.
    # Override session/pane variables inherited from a devbox Herdr pane.
    command env -u HERDR_SESSION -u HERDR_ENV -u HERDR_CLIENT_SOCKET_PATH \
        HERDR_SOCKET_PATH="$socket" HERDR_REMOTE_KEYBINDINGS=server \
        herdr client
end
