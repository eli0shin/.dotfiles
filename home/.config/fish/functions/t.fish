function t
    tmux attach -t "$(tmux list-sessions -F '#{session_activity} #{session_name}' \
    | sort -rn | head -1 | cut -d' ' -f2-)" || tmux
end
