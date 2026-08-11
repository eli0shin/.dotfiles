# Remote clipboard and Herdr paste-input diagnosis

## Scope

This note covers text copy and paste across:

```text
Ghostty or Moshi → mosh/SSH → tmux → Herdr → focused pane
```

It distinguishes two independent directions:

- **Remote copy:** a DevBox application writes text to the client clipboard.
- **Client paste:** the client reads its own clipboard and sends text as terminal input.

A headless DevBox has no server-side system clipboard in the current setup.

## Current standard

The current terminal-native standard for remote copy is **OSC 52**. A remote application sends a Base64 payload with an operating-system control sequence such as:

```text
ESC ] 52 ; c ; <base64> BEL
```

The terminal client decodes the payload and writes it to its local clipboard. Ghostty documents both OSC 52 writes and queries, and defaults `clipboard-write` to `allow` and `clipboard-read` to `ask`:

- [Ghostty OSC 52 documentation](https://ghostty.org/docs/vt/osc/52)
- [Ghostty clipboard configuration](https://ghostty.org/docs/config/reference#clipboard-read)

Client-to-remote text paste does not require a clipboard on the server. The client handles its paste action and sends the clipboard text as terminal input. Moshi documents double-tap, hardware-keyboard `Cmd+V`, and its toolbar button as client-side paste actions. Ghostty exposes `paste_from_clipboard` and binds it to `Cmd+V` on macOS:

- [Moshi clipboard documentation](https://getmoshi.app/docs/clipboard)
- [Ghostty `paste_from_clipboard` action](https://ghostty.org/docs/config/keybind/reference#paste_from_clipboard)

Applications can enable bracketed-paste mode so the client surrounds pasted text with `ESC[200~` and `ESC[201~`. Herdr already has a path that forwards bracketed paste to its focused pane, as shown by [Herdr issue #1686](https://github.com/herdrdev/herdr/issues/1686).

## Client paste versus remote clipboard reads

Moshi documents three supported ways to send its local clipboard into the terminal: double-tap, hardware-keyboard `Cmd+V`, and the toolbar Paste button. These are client-side paste actions. They send clipboard text as terminal input and do not require the remote application to query the client clipboard:

- [Moshi clipboard documentation](https://getmoshi.app/docs/clipboard)

Moshi documents OSC 52 only in the other direction: the remote host writes to the iOS clipboard. It does not document host-initiated OSC 52 clipboard reads.

Mosh 1.4.0 likewise advertises **OSC 52 clipboard copy integration**, not clipboard-query support. Its source has no OSC 52 query implementation. It treats every exact `52;c;<payload>` sequence as synchronized clipboard state. Because Mosh sends a clipboard state only when that state changes, even forwarding `52;c;?` incidentally would be unreliable for repeated queries. [Mosh issue #1090](https://github.com/mobile-shell/mosh/issues/1090) documents this state-deduplication defect.

Neovim's tmux provider reads with:

```text
tmux refresh-client -l && sleep 0.05 && tmux save-buffer -
```

That asks an attached terminal client for its clipboard through OSC 52. Neovim's `clipboard=unnamedplus` makes plain `p` use this provider when Neovim does not already own a cached selection. This query path is not a documented Mosh 1.4.0 capability and must not be treated as reliable through Mosh. A successful `p` can instead return Neovim's cached selection, persisted register, or the existing tmux buffer.

Keyboard meanings remain application-specific:

- Moshi's Paste button, double-tap, and `Cmd+V` are clipboard paste actions.
- `Ctrl+V` is not Moshi's documented paste shortcut.
- In Neovim, `Ctrl+V` enters Visual Block mode in Normal mode and quotes the next character in Insert mode; it does not request the client clipboard.
- In Fish, `Ctrl+V` quotes the next character; it is not a clipboard paste action.

The reliable Mosh direction for client clipboard text is therefore **client paste action → terminal input**, not **remote application → OSC 52 query → client response**.

## Official Mosh behavior

Mosh 1.4.0 added OSC 52 clipboard-copy integration:

- [Mosh 1.4.0 release](https://github.com/mobile-shell/mosh/releases/tag/mosh-1.4.0)

The released Mosh 1.4.0 parser is stricter than the general OSC 52 format. Its source accepts only sequences whose payload begins exactly with `52;c;`. It does not accept an omitted clipboard selector such as `52;;`:

- [`src/terminal/terminalfunctions.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/terminal/terminalfunctions.cc)

The released implementation also stores clipboard state in Mosh's synchronized framebuffer. It sends a clipboard update only when that stored value changes and limits the captured OSC payload to 16 KiB. This causes a known repeated-copy defect: copying the same remote value again does not update a client clipboard that changed independently:

- [Mosh issue #1090](https://github.com/mobile-shell/mosh/issues/1090)

Mosh PR [#1104](https://github.com/mobile-shell/mosh/pull/1104) broadens selector support, preserves the selector, and adds a sequence number for repeated values. The PR remains open and is not part of Mosh 1.4.0. Community reports in [PR #1054](https://github.com/mobile-shell/mosh/pull/1054) and [tmux issue #3423](https://github.com/tmux/tmux/issues/3423) identify the same `tmux + mosh` selector mismatch.

## Official tmux behavior

The tmux clipboard interface uses OSC 52 through the `Ms` terminal capability. The official clipboard guide requires:

1. `set-clipboard` set to `external` or `on`.
2. An `Ms` capability for the outside terminal.
3. OSC 52 enabled in the outside terminal.

`external` is the documented default. It lets tmux set the outside clipboard but does not let arbitrary pane applications create tmux buffers through raw OSC 52. This policy is sufficient when an application invokes `tmux load-buffer -w`, because tmux itself emits the OSC 52 update:

- [tmux clipboard guide](https://github.com/tmux/tmux/wiki/Clipboard)

Neovim 0.12's built-in tmux clipboard provider uses:

```text
tmux load-buffer -w -
tmux refresh-client -l && tmux save-buffer -
```

The first command asks tmux to set its buffer and write the outside terminal clipboard. The second asks an attached client for its clipboard and stores the reply in a tmux buffer. tmux maintainers document that raw OSC 52 query passthrough is not reliable because tmux cannot safely route an asynchronous response to the originating pane:

- [tmux issue #3068](https://github.com/tmux/tmux/issues/3068)

## DevBox probes

No configuration or active process was changed by these probes.

### Installed versions

```text
Mosh 1.4.0
OpenSSH 9.6p1
Tmux 3.7b
Neovim 0.12.4
Herdr 0.8.0
```

### Clipboard environment

The DevBox has no `DISPLAY` or `WAYLAND_DISPLAY`, and no `pbcopy`, `wl-copy`, `xclip`, `xsel`, or equivalent clipboard command. Neovim outside tmux reports no clipboard provider.

In an isolated tmux pane, Neovim health reports:

```text
OK Clipboard tool found: tmux
```

This explains why a Neovim yank can survive into another Neovim process without proving that the client clipboard was updated. Neovim can retrieve the tmux buffer through its tmux provider; Neovim register persistence can also preserve yanks.

### Effective tmux state at diagnosis time

```text
set-clipboard: external
allow-passthrough: on
extended-keys: on
extended-keys-format: csi-u
Ms: \033]52;%p1%s;%p2%s\a
client terminal feature: clipboard
```

All five attached tmux clients were parented by active `mosh-server` sessions. There was no attached SSH-only client available for an end-to-end comparison.

### Decisive protocol probe

An isolated tmux server with the current effective `Ms` capability emitted this shape for `set-buffer -w`:

```text
ESC ] 52 ; ; <base64> BEL
```

The Base64 payload was correct, but the clipboard selector was empty. Released Mosh 1.4.0 accepts only:

```text
ESC ] 52 ; c ; <base64> BEL
```

Therefore the DevBox-side Mosh parser drops tmux's clipboard update before either Ghostty or Moshi can receive it. This explains why both clients show the same behavior.

An isolated tmux server then tested this capability override while preserving `set-clipboard external`:

```tmux
set -as terminal-overrides ',xterm*:Ms=\E]52;c;%p1%.0s%p2%s\7'
```

Probe result:

```text
recommended_override_exact_sequence=pass
set_clipboard_policy=external
```

The `%p1%.0s` expression consumes tmux's first string parameter without printing it. This is necessary with the installed tmux 3.7b terminfo formatter; the commonly discussed `%p2%s`-only override produced no output in the isolated probe. The override then emits the exact `52;c;` form accepted by Mosh 1.4.0.

## Herdr community findings

### Closest report to the original symptom

[Herdr issue #1585](https://github.com/herdrdev/herdr/issues/1585) reports that paste does not work in any Herdr pane: it fails in both the shell and Claude Code, while the same terminal works outside Herdr and with tmux or Zellij. The shortcut inserts a literal `v` instead.

The maintainer reproduced the failure in VS Code. They found that `terminal.integrated.sendKeybindingsToShell = true` forwards the shortcut to Herdr instead of making VS Code send paste data. Herdr's extended keyboard reporting then makes VS Code send `v`. The maintainer closed the issue as a terminal configuration conflict. This report has a different terminal environment from the current Mosh problem.

### Mosh report

[Herdr issue #805](https://github.com/herdrdev/herdr/issues/805) reports that `Ctrl+V` stopped working after starting Herdr through SSH or Mosh. The report concerns image paste, not text paste. The reporter later withdrew it because they could not reproduce the earlier behavior and believed another tool or an iOS client caused it.

### Evidence that Herdr has a paste-input path

[Herdr issue #1686](https://github.com/herdrdev/herdr/issues/1686) shows terminal paste reaching a Herdr pane as bracketed-paste input. [Herdr issue #670](https://github.com/herdrdev/herdr/issues/670) reports multiline paste reaching pane applications and was fixed in Herdr 0.7.1. These reports show that Herdr has a terminal paste-input path.

[Herdr issue #647](https://github.com/herdrdev/herdr/issues/647) and [issue #986](https://github.com/herdrdev/herdr/issues/986) distinguish a raw `Ctrl+V` key from a terminal paste action. Raw local `Ctrl+V` passes through as a key; the outer terminal's paste action is responsible for sending clipboard text.

## Neovim yanks in standalone Herdr (no tmux)

A standalone Herdr 0.8.0 pane correctly reports OSC 52 support to Neovim 0.12.4, but the current Neovim configuration prevents the automatic OSC 52 provider from being selected.

An isolated named Herdr server started with `TMUX` and `TMUX_PANE` unset produced this Neovim TUI diagnostic:

```json
{
  "clipboard": "unnamedplus",
  "provider": "",
  "termfeatures": { "osc52": true },
  "term": "xterm-256color",
  "provider_error": "clipboard: No clipboard tool. :help clipboard"
}
```

This proves that terminal capability detection succeeds through Herdr. The decisive rule is in Neovim's official `runtime/autoload/provider/clipboard.vim`:

```vim
elseif !empty($TMUX) && executable('tmux')
  return s:set_tmux()
elseif get(get(g:, 'termfeatures', {}), 'osc52') && &clipboard ==# ''
  return s:set_osc52()
endif
```

The tmux provider is selected whenever `TMUX` is present. The automatic OSC 52 fallback is selected only when `'clipboard'` is empty. This project's `home/.config/nvim/lua/nvim-config.lua` sets:

```lua
vim.opt.clipboard = 'unnamedplus'
```

Therefore:

- inside tmux, the earlier tmux branch wins and yanks use `tmux load-buffer -w -`;
- outside tmux, no native server clipboard tool exists;
- although Herdr advertises OSC 52, `unnamedplus` makes the automatic OSC 52 branch reject itself;
- Neovim has no clipboard provider, so its yanks cannot emit OSC 52 for Herdr to forward.

This is different from Herdr selection copy. Herdr selection copy directly creates an OSC 52 write and forwards it through its client, without using Neovim's provider selection.

Neovim documents the same policy: automatic OSC 52 is used only when `'clipboard'` is unset, while an explicit `g:clipboard = 'osc52'` forces the provider and skips automatic detection. See [Neovim clipboard provider documentation](https://neovim.io/doc/user/provider/#clipboard-osc52). Herdr issue [#1204](https://github.com/herdrdev/herdr/issues/1204) reproduces the same Neovim 0.12 behavior and confirms that explicitly selecting the OSC 52 provider makes remote Neovim copy work through Herdr.

A suitable policy for this topology is to explicitly select OSC 52 only when tmux and local graphical clipboard backends are absent, before the clipboard provider is initialized:

```lua
if vim.env.TMUX == nil
    and vim.env.DISPLAY == nil
    and vim.env.WAYLAND_DISPLAY == nil then
  vim.g.clipboard = 'osc52'
end

vim.opt.clipboard = 'unnamedplus'
```

This preserves Neovim's tmux provider inside tmux and selects OSC 52 for standalone remote Herdr panes.

This explicit provider also defines OSC 52 clipboard **reads** for `p`/`"+p`. Herdr intentionally does not support pane applications reading the host clipboard through OSC 52. The Herdr maintainer documents this in closed PR [#1414](https://github.com/herdrdev/herdr/pull/1414), citing response routing and clipboard-security concerns. Thus the explicit provider fixes remote-to-client yanks, but client-to-remote text should still use the terminal client's paste action rather than relying on `"+p`.

## Neovim inside the active Herdr server

After the OSC 52 and tmux policy fixes, Herdr selection copies reached the client clipboard but Neovim yanks inside a Herdr tab did not.

A process-environment probe found:

```text
active default Herdr server: TMUX unset
attached Herdr client:       TMUX set
isolated Herdr server:       TMUX set
```

Herdr panes are owned and spawned by the persistent server, so they inherit the server environment rather than the environment of a later attached client. The active default server had been started from a shell outside tmux. Neovim in its tabs therefore cannot detect the tmux clipboard provider.

The correctly isolated Herdr server was started inside tmux. A Neovim health probe in its pane reported:

```text
OK Clipboard tool found: tmux
```

This isolates the remaining Neovim failure to the startup environment of the active default Herdr server. The server must be started from inside tmux so its future panes inherit `TMUX`. A full Herdr server stop exits its pane processes, so this restart must be scheduled after saving active work.

## Diagnosis

The initial failure was **remote-to-client clipboard copy**, not Herdr paste forwarding.

The load-bearing mismatch is:

```text
Neovim tmux provider
  → tmux 3.7b emits OSC 52 with an empty selector (`52;;`)
  → Mosh 1.4.0 accepts only selector `c` (`52;c;`)
  → clipboard update is dropped on the DevBox
  → Ghostty and Moshi have no new client clipboard text to paste
```

The same behavior in Ghostty and Moshi is expected because all observed clients use Mosh and the update is rejected by the DevBox-side Mosh parser before it reaches either client.

This is probably Mosh-specific for the current stack. OSC 52 permits an omitted selector, and Ghostty treats an omitted selector as its default clipboard. SSH normally carries terminal output without Mosh's framebuffer parser, so tmux's current `52;;` sequence should reach Ghostty. This expectation was not verified end to end because no SSH-only client was attached during the probe.

The earlier Neovim-close/reopen success is not evidence of a DevBox system clipboard. It is explained by Neovim's tmux provider and/or persistent registers.

## Applied configuration

The tested Mosh compatibility override makes tmux emit the OSC 52 form that released Mosh 1.4.0 accepts:

```tmux
set -as terminal-overrides ',xterm*:Ms=\E]52;c;%p1%.0s%p2%s\7'
```

Neovim then copied successfully because its tmux provider invokes `tmux load-buffer -w`, which tmux permits under `set-clipboard external`.

Herdr standalone also copied successfully, but Herdr under tmux did not. Herdr emits raw OSC 52 as pane output. The `external` policy rejects OSC 52 from pane applications. After confirming this difference, the selected policy was:

```tmux
set -s set-clipboard on
```

This allows pane applications such as Herdr to write the client clipboard. It also allows any other pane application to replace clipboard content through OSC 52, which is the documented security difference from `external`. This change does not add a DevBox clipboard, daemon, external package, or second synchronization mechanism.

After applying the terminal capability override, all tmux clients using the affected terminal description must be recreated so tmux rebuilds their terminal capabilities. The official tmux guide recommends a full tmux server restart after clipboard capability changes. Because that would stop existing panes, schedule it rather than doing it during active work.

Then validate these paths separately:

1. In Neovim under tmux, yank a unique line and confirm it appears in the Ghostty or Moshi clipboard.
2. Paste known client-local text into plain Fish. This validates client-to-remote input independently of OSC 52 copy.
3. Paste the same known text into a Herdr pane. If step 2 passes and step 3 fails, investigate Herdr input as a separate defect.
4. Open one SSH-only client and repeat step 1. This confirms whether the remaining defect is Mosh-specific.

Do not add a DevBox system clipboard for this use case. It would create a separate clipboard and would still require synchronization with each client.

### Remaining Mosh 1.4.0 limitations

The override fixes the selector mismatch. It does not fix Mosh 1.4.0's repeated-identical-copy cache bug or its 16 KiB OSC capture limit. If those become material, the long-term upstream fix is Mosh PR #1104 or a later Mosh release containing equivalent changes. A custom Mosh build on every client and server is not the first recommendation for the current single-line failure.
