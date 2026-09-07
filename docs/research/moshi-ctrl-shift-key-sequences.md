# Why Moshi does not trigger Pi's `Ctrl+Shift+G` binding

## Question

Why does Pi not scroll to the bottom when an iPhone Moshi session uses the toolbar to select Ctrl, then iOS Shift, then `g`?

The local Pi configuration is:

```json
"tui.altScreen.bottom": "ctrl+shift+g"
```

Source: [`home/.pi/agent/keybindings.json`](../../home/.pi/agent/keybindings.json)

## Conclusion

The probable input is the single legacy control byte `0x07` (`BEL`), which means `Ctrl+G`. Legacy terminal input cannot preserve Shift for this chord: `Ctrl+g` and `Ctrl+Shift+g` collapse to the same byte.

Pi intentionally does **not** treat that byte as `Ctrl+Shift+G`. It accepts `Ctrl+Shift+G` only through an enhanced keyboard sequence such as:

```text
ESC [ 103 ; 6 u
```

That is Kitty keyboard protocol notation for the unshifted `g` codepoint (`103`) with Ctrl+Shift (`6`, because the protocol adds one to the modifier bit field).

Moshi's public keyboard documentation describes traditional terminal-byte behavior. It says that `Shift+t` sends the same bytes as capital `T`. It does not document Kitty keyboard protocol or xterm `modifyOtherKeys` support. Mosh also prevents Pi's enhanced-keyboard negotiation from reaching the outer iPhone terminal. Therefore, tapping Ctrl, Shift, and `g` cannot reliably produce a distinct `Ctrl+Shift+G` event in this path.

This is mainly a protocol limitation, not an incorrect tap order.

## What happens

```text
Moshi toolbar Ctrl + iOS Shift + g
                  │
                  ▼
       legacy Ctrl+G byte: 0x07
       Shift identity is already lost
                  │
                  ▼
            Mosh / tmux
       cannot restore the modifier
                  │
                  ▼
                 Pi
  sees Ctrl+G, not Ctrl+Shift+G
```

### 1. Moshi documents legacy-style shortcut encoding

Moshi says a toolbar Ctrl tap activates Ctrl for the next key. Its shortcut documentation gives `Ctrl+C` and similar chords. For Shift on letters, its advanced-binding example explicitly says `S-t` sends the same bytes as capital `T`.

That byte-oriented model can represent uppercase text, but it cannot distinguish `Ctrl+g` from `Ctrl+Shift+g`. Applying the conventional control transformation to either `g` (`0x67`) or `G` (`0x47`) gives `0x07`.

Moshi's public documentation does not claim Kitty keyboard protocol or `modifyOtherKeys` support. Moshi is not publicly documented as open source, so this research could not verify its private input implementation directly.

Sources:

- [Moshi: Keyboard and shortcuts](https://getmoshi.app/docs/keyboard)
- [Moshi: Mastering Moshi's Terminal Keyboard](https://getmoshi.app/articles/moshi-keyboard-guide)

### 2. A distinct `Ctrl+Shift+G` needs an enhanced keyboard protocol

The Kitty keyboard protocol specification lists two legacy-terminal problems directly:

- no reliable way to use multiple modifiers such as Ctrl+Shift;
- ambiguous encodings where different key presses produce the same bytes.

Under Kitty encoding, `Ctrl+Shift+g` is `CSI 103;6u`, or these bytes:

```text
1b 5b 31 30 33 3b 36 75
```

The key remains `103`, the lowercase/unshifted codepoint. Shift has bit value 1 and Ctrl has bit value 4. The wire modifier is therefore `1 + 1 + 4 = 6`.

Source: [Kitty keyboard protocol: key codes, modifiers, and progressive enhancement](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)

### 3. Pi requires the enhanced form for this exact chord

Pi supports combined modifiers in its keybinding format. Its input matcher handles a raw control byte only when the requested modifier is Ctrl alone. For Ctrl+Shift plus a printable key, it accepts Kitty `CSI u` or xterm `modifyOtherKeys`; it does not accept the ambiguous raw control byte.

This behavior is necessary. If Pi interpreted `0x07` as `Ctrl+Shift+G`, it could no longer distinguish it from `Ctrl+G`. Pi uses `Ctrl+G` for search-next while transcript search is active. Pi's normal `app.editor.external` default is also `Ctrl+G`, although the local configuration has moved that action to `Ctrl+E`.

Pi starts by sending a Kitty push/query and a device-attributes query. If it receives no Kitty response, it requests xterm `modifyOtherKeys` as a fallback.

Sources:

- [Pi keybinding documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md)
- [Pi key matcher: `packages/tui/src/keys.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/tui/src/keys.ts#L1148-L1200)
- [Pi keyboard negotiation: `packages/tui/src/terminal.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/tui/src/terminal.ts)
- [Pi terminal setup](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md)

### 4. Mosh blocks the negotiation path

This point is separate from Moshi's toolbar behavior. Mosh is not a transparent terminal byte stream from host to client. It parses host output into persistent terminal state and synchronizes that state. A Mosh maintainer states that Mosh only passes changes to terminal state.

Current Mosh source handles a limited set of CSI functions. It answers device attributes itself as a VT220. It has no handler for Kitty's `CSI > ... u` push/query/pop controls or xterm's `CSI > 4;...m` modifier-key controls. Unsupported controls do not reach the outer terminal.

As a result:

1. Pi's Kitty request does not reach Moshi.
2. Mosh's own device-attributes response makes Pi use its fallback.
3. Pi's `modifyOtherKeys` request also does not reach Moshi.
4. Moshi continues to send legacy-style input.

Mosh PR #983 exists specifically to add modifier-key-resource support, but it remains open and is not in released Mosh behavior.

Sources:

- [Mosh architecture](https://mosh.org/#techinfo)
- [Mosh issue #1135: pass-through of custom escape sequences](https://github.com/mobile-shell/mosh/issues/1135)
- [Mosh terminal function implementation](https://github.com/mobile-shell/mosh/blob/master/src/terminal/terminalfunctions.cc)
- [Mosh user-input path](https://github.com/mobile-shell/mosh/blob/master/src/terminal/terminaluserinput.cc)
- [Mosh PR #983: modifier key resources](https://github.com/mobile-shell/mosh/pull/983)

A tmux layer cannot recover Shift after Moshi has reduced the event to `0x07`. Depending on its configuration, tmux can also affect keyboard protocol negotiation, but it is not needed to explain this failure.

## Recommended fix

Use a binding that has an unambiguous legacy terminal representation. The simplest choice is Pi's normal fullscreen bottom key, `End`, because Moshi has a documented `End` toolbar key.

To retain both desktop and phone access, use:

```json
{
  "tui.altScreen.bottom": ["end", "ctrl+shift+g"]
}
```

Then use Moshi's **End** toolbar button on the iPhone. Pi's keybinding documentation says that user bindings can be arrays and that `end` is the default `tui.altScreen.bottom` binding.

Other practical options are:

- assign a Moshi gesture or D-pad slot to `End`;
- choose an unused function key such as `F12` and bind the same key in Pi;
- choose another single Ctrl chord only if it does not conflict with Herdr or Pi. Do not use `Ctrl+G`: it is the configured Herdr prefix.

Do not expect Moshi's advanced binding `C-S-g` to fix this unless Moshi explicitly adds enhanced keyboard-protocol encoding. Its documented shortcut model still describes terminal keystrokes, and its Shift-letter example is byte-equivalent to uppercase text.

## How to confirm on the affected session

Outside Pi, run this on the remote host:

```sh
showkey -a
```

Then send these through Moshi:

1. Ctrl, then `g`.
2. Ctrl, then Shift, then `g`.

If both report decimal `7`, octal `0007`, or `^G`, Shift was lost before Pi received the event.

For comparison, a working enhanced terminal path should deliver `Ctrl+Shift+G` as a CSI sequence such as `ESC [ 103 ; 6 u`, not as one `0x07` byte.

## Confidence and limits

Confidence is high that a received `0x07` cannot trigger Pi's `ctrl+shift+g` matcher and that released/current Mosh does not carry Pi's keyboard-mode negotiation to the outer terminal.

Confidence is medium-high that Moshi emits `0x07` for the described taps. That matches its official documented byte model, but Moshi's implementation source is not available for direct inspection. The `showkey -a` test can confirm the actual installed app version.