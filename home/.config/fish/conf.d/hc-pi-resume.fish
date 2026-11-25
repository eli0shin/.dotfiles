# Resume the pi session a herdr-core terminal last ran when the terminal is
# reopened (reboot, crash, holder kill), as legacy herdr's
# resume_agents_on_restore did. herdr-core reopens a kept terminal with a
# fresh login shell and keeps its labels. hc-session-label.ts labels the
# terminal with pi's session file and the token of the shell pi ran under. On
# its first prompt, a shell that finds a session labelled under another token
# resumes it. Nothing here ever clears the label: a shutdown kills pi exactly
# the way quitting it does, so the shell can't tell them apart.
status is-interactive; or return
set -q HC_TERMINAL_ID; or return

set -l token (string split -- - "$DOTFILES_HC_SHELL")
if test "$token[1]" != "$HC_TERMINAL_ID"
    # The first shell of this program: a new terminal, or a lost one reopened.
    set -gx DOTFILES_HC_SHELL "$HC_TERMINAL_ID-$fish_pid-"(random 100000000 999999999)
else
    return
end

function __dotfiles_hc_pi_resume
    command -q hc; and command -q jq; or return
    set -l labels (command hc get $HC_TERMINAL_ID --json 2>/dev/null |
        command jq -r '.labels["dotfiles.pi_session"] // "", .labels["dotfiles.pi_shell"] // ""')
    or return
    set -l session $labels[1]
    set -l shell $labels[2]
    test -n "$session"; and test "$shell" != "$DOTFILES_HC_SHELL"; and test -f "$session"; or return
    set_color --dim
    echo "Resuming pi session $session"
    set_color normal
    # Run pi as if typed at the prompt. fish keeps a command run from an event
    # handler in its own process group and never hands it the terminal. The
    # leading space keeps the command out of history.
    # herdr-core tracks pi as an agent from its OSC 7501 status reports. pi
    # only reports once the terminal answers its 7501 query before DA, but
    # this early, the reply to fish's own startup DA query reaches pi first and
    # pi decides the terminal can't take reports. herdr-core always can.
    commandline --replace -- " PI_PROGRAM_STATUS=1 pi --session "(string escape -- $session)
    commandline -f execute
end

function __dotfiles_hc_pi_prompt --on-event fish_prompt
    functions -e __dotfiles_hc_pi_prompt
    __dotfiles_hc_pi_resume
end
