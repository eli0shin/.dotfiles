# Resume the pi session a herdr-core terminal was running when its program
# was lost (reboot, crash, holder kill), as legacy herdr's
# resume_agents_on_restore did. herdr-core reopens a kept terminal with a
# fresh login shell and keeps its labels. hc-session-label.ts labels the
# terminal with pi's session file and the token of the shell pi ran under, and
# leaves a marker named after that token. On its first prompt, a shell that
# finds a session labelled under another token resumes it. At each prompt, the
# token's own shell clears the label once pi has returned to it, so only a pi
# that was still running when the terminal was lost comes back.
status is-interactive; or return
set -q HC_TERMINAL_ID; or return

set -g __dotfiles_hc_pi_markers (set -q XDG_STATE_HOME; and echo $XDG_STATE_HOME; or echo ~/.local/state)/dotfiles/hc-pi
set -l token (string split -- - "$DOTFILES_HC_SHELL")
if test "$token[1]" != "$HC_TERMINAL_ID"
    # The first shell of this program: a new terminal, or a lost one reopened.
    set -gx DOTFILES_HC_SHELL "$HC_TERMINAL_ID-$fish_pid-"(random 100000000 999999999)
    set -g __dotfiles_hc_pi_check_resume
else if test "$token[2]" != "$fish_pid"
    # A nested shell. A shell that replaced the first one with exec keeps its
    # pid, so it still clears the label for the pi it ran.
    return
end

function __dotfiles_hc_pi_forget --argument-names shell
    command hc label $HC_TERMINAL_ID dotfiles.pi_session= dotfiles.pi_shell= >/dev/null 2>&1
    and command rm -f $__dotfiles_hc_pi_markers/$shell
end

function __dotfiles_hc_pi_resume
    command -q hc; and command -q jq; or return
    set -l labels (command hc get $HC_TERMINAL_ID --json 2>/dev/null |
        command jq -r '.labels["dotfiles.pi_session"] // "", .labels["dotfiles.pi_shell"] // ""')
    or return
    set -l session $labels[1]
    set -l shell $labels[2]
    test -n "$session"; and test "$shell" != "$DOTFILES_HC_SHELL"; or return
    # The old shell is gone, and so is any chance of it clearing its marker.
    test -n "$shell"; and command rm -f $__dotfiles_hc_pi_markers/$shell
    if not test -f "$session"
        __dotfiles_hc_pi_forget $shell
        return
    end
    set_color --dim
    echo "Resuming pi session $session"
    set_color normal
    pi --session $session
end

function __dotfiles_hc_pi_returned
    test -e $__dotfiles_hc_pi_markers/$DOTFILES_HC_SHELL
    and __dotfiles_hc_pi_forget $DOTFILES_HC_SHELL
end

# pi returned to this shell, so the terminal no longer runs it.
function __dotfiles_hc_pi_prompt --on-event fish_prompt
    if set -q __dotfiles_hc_pi_check_resume
        set -e __dotfiles_hc_pi_check_resume
        __dotfiles_hc_pi_resume
    end
    __dotfiles_hc_pi_returned
end

# A resumed pi killed by SIGINT cancels the rest of the prompt handler, so
# check again before the next command.
function __dotfiles_hc_pi_preexec --on-event fish_preexec
    __dotfiles_hc_pi_returned
end
