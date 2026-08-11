# Neovim remote `gx` and client URL opening

## Question

How can `gx` or “open external” in Neovim running on DevBox open a URL in the browser on the client Mac when the terminal path is SSH or Mosh, tmux, and Herdr?

The iOS path can continue to use Moshi's clickable links. The required path is macOS Ghostty.

## Current behavior

Neovim maps `gx` to `vim.ui.open()`. `vim.ui.open()` starts an operating-system opener on the machine where Neovim runs: `open` on macOS, `xdg-open` on Linux, and similar handlers on other systems. Therefore Neovim on DevBox cannot directly call the Mac's URL handler.

Sources:

- [Neovim `gx`](https://neovim.io/doc/user/various/#gx)
- [Neovim `vim.ui.open()`](https://neovim.io/doc/user/lua/#vim.ui.open())
- Installed Neovim 0.12.4 implementation: `/home/linuxbrew/.linuxbrew/share/nvim/runtime/lua/vim/ui.lua`

Oil's configured `gx` action also calls `vim.ui.open(path)` when that API exists. A global remote override of `vim.ui.open` therefore covers normal Neovim `gx`, LSP document links, and Oil's `actions.open_external`.

## There is no direct Ghostty escape for “open this URL”

Ghostty supports two relevant URL features:

1. It detects visible URLs and opens them after a macOS Command-click.
2. It supports OSC 8 hyperlinks. OSC 8 associates displayed cells with a URI, but opening still requires a user action.

Ghostty's current iTerm2 OSC 1337 parser recognizes the `OpenURL` key only as an unimplemented key and discards it. An open Ghostty proposal describes adding unsolicited `OSC 1337;OpenURL`, but it is not an available capability. The proposal also identifies the security issue: a remote process could invoke arbitrary local URL handlers.

Sources:

- [Ghostty `link-url` option](https://ghostty.org/docs/config/reference#link-url)
- [Ghostty OSC 8 documentation](https://ghostty.org/docs/vt/osc/8)
- [Ghostty OSC 1337 parser](https://github.com/ghostty-org/ghostty/blob/main/src/terminal/osc/parsers/iterm2.zig)
- [Ghostty discussion #12948: Add support for OSC 1337 OpenURL?](https://github.com/ghostty-org/ghostty/discussions/12948)

Consequently, `gx` cannot make Ghostty open a URL through terminal output alone. OSC 8 can make a short label represent a long URL, but it cannot perform the open action.

## Mosh limitations

Installed Mosh 1.4.0 does not support OSC 8 hyperlinks. Its OSC parser handles OSC 52 clipboard state and limited title sequences; other OSC sequences are not represented in the synchronized framebuffer. OSC 8 support was merged to Mosh `master` in March 2026, after 1.4.0, but it still only supplies clickable hyperlinks.

Mosh also does not keep the SSH bootstrap connection as a forwarding channel. Mosh issue #337 remains the primary record for port forwarding. The Mosh maintainers explain that Mosh synchronizes terminal state over UDP and does not provide SSH-style reliable byte streams. Closed attempts to retain SSH forwarding were not merged.

Sources:

- Installed Mosh 1.4.0 source: `/tmp/mosh-source/src/terminal/terminalfunctions.cc`
- [Mosh PR #1360: OSC 8 hyperlink support](https://github.com/mobile-shell/mosh/pull/1360)
- [Mosh issue #337: SSH port forwarding](https://github.com/mobile-shell/mosh/issues/337)
- [Mosh architecture](https://mosh.org/#techinfo)

Thus:

- OSC 8 is not a solution for the installed Mosh version.
- A reverse forward passed to Mosh's startup `ssh` command will disappear when bootstrap finishes.
- Any TCP opener used with Mosh needs an independent connection.

## Neovim's supported remote opener: Lemonade

Neovim 0.11 added Lemonade as a supported `vim.ui.open()` handler for SSH use. The installed 0.12.4 implementation can run:

```text
lemonade open <URL>
```

Lemonade is a client/server remote utility. A Lemonade client on DevBox sends an open request to a Lemonade server on the Mac, and the Mac server invokes its local URL handler.

Lemonade itself has no encryption or authentication. Its official documentation recommends binding it to loopback and carrying it through an SSH reverse forward:

```text
Mac browser
    ↑
Mac lemonade server on 127.0.0.1:2489
    ↑
independent encrypted SSH reverse forward
    ↑
DevBox 127.0.0.1:2489
    ↑
DevBox lemonade open <URL>
    ↑
Neovim vim.ui.open / gx
```

Sources:

- [Neovim 0.11 release notes](https://neovim.io/doc/user/news-0.11/#news-0.11)
- [Lemonade official repository and README](https://github.com/lemonade-command/lemonade)
- [OpenSSH `-R` remote forwarding](https://man.openbsd.org/ssh.1#R)

### Important Lemonade details

- The latest Go module is `github.com/lemonade-command/lemonade@v1.1.2`.
- The project asks for maintainers and has an old release history. It is useful and Neovim supports it, but it is not a modern security boundary.
- The server must use `--allow=127.0.0.1` rather than Lemonade's permissive default.
- The SSH remote listener must be explicitly bound to `127.0.0.1`.
- Any process on DevBox that can connect to that loopback port can ask the Mac to open a URI. Lemonade does not authenticate callers or restrict URI schemes.
- Lemonade falls back to a local server when its configured server is unavailable. A wrapper should first verify the forwarded endpoint and fail closed so a broken tunnel does not silently return to opening URLs on DevBox.
- With a reverse tunnel, Lemonade's loopback and local-file translation features do not produce useful remote-file semantics. The remote Neovim integration should initially accept only `http://` and `https://` URLs and disable `trans-loopback` and `trans-localfile`.

Sources:

- [Lemonade README: usage, security, and SSH forwarding](https://github.com/lemonade-command/lemonade/blob/master/README.md)
- [Lemonade client fallback source](https://github.com/lemonade-command/lemonade/blob/master/client/client.go)
- [Lemonade URI opener source](https://github.com/lemonade-command/lemonade/blob/master/server/uri.go)

## SSH transport

For a normal SSH session, the client can carry the opener endpoint with a reverse forward:

```sh
ssh \
  -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:2489:127.0.0.1:2489 \
  elioshinsky@devbox.home.arpa
```

OpenSSH documents that `-R` creates the listener on the remote host and forwards connections to the local side. An explicit `127.0.0.1` bind keeps the remote listener off external interfaces. `ExitOnForwardFailure=yes` makes startup fail if the listener cannot be established.

Sources:

- [OpenSSH `ssh(1)` `-R`](https://man.openbsd.org/ssh.1#R)
- [OpenSSH `ExitOnForwardFailure`](https://man.openbsd.org/ssh_config.5#ExitOnForwardFailure)

## Mosh transport

Mosh needs the same reverse forward in a separate SSH process. Because the Mac can sleep or roam while Mosh survives, a plain background SSH process is not sufficient for long-lived behavior. `autossh` is designed to restart an SSH tunnel when SSH exits or stops passing traffic. Its official documentation recommends:

- `-M 0` with OpenSSH `ServerAliveInterval` and `ServerAliveCountMax`.
- `ExitOnForwardFailure=yes`.
- Automatic authentication suitable for unattended reconnection.

An example shape is:

```sh
AUTOSSH_GATETIME=0 autossh -M 0 -f -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:2489:127.0.0.1:2489 \
  elioshinsky@devbox.home.arpa
```

This tunnel is independent of Mosh. It can reconnect after the Mac's network changes while the Mosh session remains alive.

Source:

- [autossh official README](https://www.harding.motd.ca/autossh/README.txt)

## Neovim integration requirement

Installing Lemonade alone is not enough in every environment. Neovim checks platform handlers in order, and `xdg-open` has priority over Lemonade. The remote configuration should explicitly route eligible URLs to Lemonade instead of depending on automatic detection.

The override should:

1. Activate only in a remote environment such as `SSH_CONNECTION`.
2. Preserve local macOS `vim.ui.open()` behavior.
3. Accept only `http://` and `https://` initially.
4. Call a fail-closed wrapper around Lemonade.
5. Return Neovim's normal `vim.SystemObj, error` result so `gx` error reporting still works.

The current Herdr servers launched through SSH and Mosh retain `SSH_CONNECTION`, so this condition is available in the actual topology.

## Alternatives

| Option | Direct `gx` | SSH | installed Mosh 1.4 | Extra local process | Notes |
|---|---:|---:|---:|---:|---|
| Lemonade through reverse SSH tunnel | Yes | Yes | Yes, with separate tunnel | Yes | Neovim-supported; security and lifecycle must be constrained |
| OSC 8 short hyperlink | No, click required | Yes | No | No | Mosh `master` supports it, but installed 1.4.0 does not |
| Print the full URL | No, click required | Yes | Yes | No | Long and wrapped URLs are unreliable to click |
| OSC 52 copy URL | No | Yes | Yes with current fixes | No | Reliable fallback, but user must paste into a browser |
| iTerm2 OSC 1337 OpenURL | Potentially | Terminal-dependent | No | No | Ghostty explicitly does not implement OpenURL |
| Expose Lemonade directly over LAN/VPN | Yes | Yes | Yes | Yes | Not recommended because Lemonade has no authentication or encryption |

## Recommendation

For exact keyboard-driven `gx` on macOS Ghostty, use a constrained Lemonade channel:

1. Install Lemonade on the Mac and DevBox.
2. Run the Mac Lemonade server as a per-user process bound to `127.0.0.1` with `allow=127.0.0.1`.
3. Maintain a loopback-only SSH reverse forward with autossh. Do not depend on Mosh's bootstrap SSH process.
4. Add a DevBox wrapper that fails if the forward is unavailable and only accepts HTTP(S) URLs.
5. Override remote `vim.ui.open()` to call that wrapper. This also covers Oil's `open_external` action.
6. Keep current click behavior on iOS. Do not add a client opener there unless keyboard-driven opening becomes necessary.

This is the smallest design that provides a real client-side open action. A pure Ghostty/tmux/Mosh escape-sequence solution is not currently available.
