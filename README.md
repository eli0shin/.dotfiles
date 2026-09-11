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

## Adding New Configs

1. Add config to `home/.config/<app>/` or `home/.<file>`
2. Run `dot stow` to create symlinks
3. Commit changes
