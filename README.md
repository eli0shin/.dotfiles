# Dotfiles

Personal dotfiles managed with GNU Stow.

## Quick Start

```bash
# Clone the repo
git clone git@github.com:eli0shin/.dotfiles.git ~/.dotfiles

# Run setup
~/.dotfiles/dot
```

## Commands

```bash
dot                   # Full setup: brew, packages, stow
dot stow              # Create symlinks
dot unstow            # Remove symlinks
dot update            # Pull repo and run setup
dot doctor            # Check installation health
dot automount apply   # Configure macOS network automounts
dot keyboard apply    # Apply keyboard remappings (macOS / Omarchy)
dot edit              # Open dotfiles in editor
dot benchmark-shell   # Benchmark Fish shell startup performance
dot benchmark-shell -r 20 -v  # 20 runs with per-run timing
dot completions       # Generate Fish shell completions for `dot`
dot package add <pkg> # Add package to Brewfile
dot package remove <pkg> # Remove package
dot package list      # List packages
dot link              # Install dot to /usr/local/bin
```

## Structure

```
~/.dotfiles/
├── dot              # CLI entrypoint and command dispatcher
├── lib/
│   ├── common.sh
│   ├── packages.sh
│   ├── dotfiles.sh
│   ├── daemons.sh
│   ├── settings.sh
│   └── maintenance.sh
├── home/            # Configs that symlink to ~
│   ├── .config/
│   │   ├── nvim/
│   │   ├── fish/
│   │   ├── tmux/
│   │   ├── ghostty/
│   │   ├── opencode/
│   │   ├── git/
│   │   └── omf/
│   └── .claude/
├── packages/
│   └── Brewfile
└── .gitignore
```

## Linux home-LAN routing with Tailscale

The personal profile's Tailscale service setup installs
`dotfiles-tailscale-lan.service` on Linux. It adds this IPv4 policy rule:

```text
2500: from all to 192.168.1.0/24 lookup main suppress_prefixlength 0
```

This prefers a specific route in the main routing table for the home LAN.
When that route disappears, the default route is suppressed for this lookup,
and routing continues to Tailscale's table. Tailscale stays connected; routes
to `10.77.10.x`, Tailscale `100.x` addresses, and DNS settings are not changed.
The `/23` advertisement workaround is not required on Linux. macOS setup is
unchanged.

**This does not identify a trusted network.** A hotel or other LAN using
`192.168.1.x` also wins over the homelab route. Other specific main-table routes
covering these destinations can also take precedence. Do not use this override
where that behavior is unacceptable.

Normal `dot service start` installs the rule with the personal Tailscale service.
To install only this rule, without changing other services:

```bash
sudo bash ~/.dotfiles/scripts/services/tailscale-lan.sh install
```

The installer copies a root-owned helper to `/usr/local/libexec/` and enables a
oneshot systemd unit. Repeated setup does not duplicate the rule. It refuses to
replace an unrelated rule at priority 2500. The rule stays installed while the
kernel adds and removes connected routes; no network-change script is needed.

Verify with `ip -4 rule show` and `ip -4 route get 192.168.1.20`. Test the
routing behavior without changing host networking:

```bash
bash ~/.dotfiles/tests/tailscale-lan.sh
```

This test needs Linux unprivileged user/network namespaces. It verifies home
routing, away-network fallback, return-home routing, unaffected Tailscale
networks, idempotence, conflict detection, and removal.

Rollback:

```bash
sudo systemctl disable --now dotfiles-tailscale-lan.service
```

Stopping the service removes only the matching rule. Remove the Linux installer
call in `scripts/services/tailscale.sh` if the rollback should survive later
`dot service start` runs. Neither installation nor rollback requires restarting
Tailscale or changing advertised routes.

## Keyboard remapping on Omarchy

`dot` setup and `dot keyboard apply` read the merged `settings/keyboard.json`
on macOS and Omarchy. Run `dot merge` first after changing a keyboard layer.

On Omarchy, the supported mappings are Caps Lock → Escape (`caps:escape`) and
Right Option/Alt → Right Control (`ctrl:ralt_rctrl`). Other mappings are rejected
without changing the config. macOS continues to use `hidutil`.

The Omarchy backend requires the Lua Hyprland configuration. It generates
`~/.config/hypr/dot-keyboard.lua` and adds one load line to `hyprland.lua`, backing
up the latter first. It preserves unrelated XKB options and replaces conflicting
ones, including Omarchy's default Caps Lock Compose key. It does not modify
packaged Omarchy files or replace your input configuration.

The mappings apply to all keyboards in Hyprland, including hot-plugged keyboards
and the desktop lock screen, but not Linux virtual consoles or other desktop
sessions. No root access or extra daemon is needed. A running session is reloaded
and checked for config errors; offline setup takes effect at the next login.
Use `dot keyboard show` to inspect the current options.

Test without changing your desktop:

```bash
bash tests/keyboard.sh
```

## Share work-Mac Herdr through devbox

On the Mac, keep this script running in a dedicated terminal/pane:

```bash
~/.dotfiles/home/.local/bin/herdr-share
# Optional alternate relay / named Herdr session:
~/.dotfiles/home/.local/bin/herdr-share elioshinsky@omarchy work
```

After SSHing into the receiving host from your iPhone, run:

```fish
work-herdr
```

The default relay is `ssh://elioshinsky@devbox.home.arpa:2222`. On the home
LAN, the LAN Ingress Boundary forwards that port to devbox SSH on port 22,
without requiring Tailscale on the Mac. Your iPhone keeps its usual devbox
connection on port 22. For a directly reachable relay, pass its normal SSH
target explicitly.
Both machines need Herdr; the Mac also needs SSH and jq. Install the Fish
function through the usual `dot stow`, or load it without stowing:

```fish
source ~/.dotfiles/home/.config/fish/functions/work-herdr.fish
```

The Mac initiates outbound SSH and reverse-forwards Herdr's API and client
Unix sockets. It does **not** enable macOS Remote Login, run an SSH server,
open a TCP listener on the Mac, or start a second Herdr session. The receiver
runs Herdr's existing client-only mode, so a missing/disconnected tunnel cannot
silently start a local session. This uses Herdr's low-level socket overrides;
it is not the standard `herdr --remote` transport.

Each tunnel gets an owner-only directory under `~/.cache/herdr-work/` on the
relay. `current` points to the most recently connected tunnel; concurrent
older tunnels do not overwrite its sockets. Ctrl-C (or closing the pane) stops
sharing, leaving Mac agents running. Remote cleanup occurs on exit or within roughly 15 seconds
of noticing a disconnected channel. A connection that fails before the remote
cleanup handler starts may leave a private unused directory. The Mac must
remain awake and connected; rerun the script after a disconnect. No persistent
service or automatic reconnection is installed.

Access to the relay account grants control of the shared Herdr session,
including starting commands on the Mac. Use this only where that remote control
and work-data relay are permitted. Agent/X11 forwarding is disabled.

## Adding New Configs

1. Add config to `home/.config/<app>/` or `home/.<file>`
2. Run `dot stow` to create symlinks
3. Commit changes
