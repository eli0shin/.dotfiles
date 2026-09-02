# Logitech Tap Cat5e Kit connection behavior

## Scope

This note covers the **Cat5e Kit for Logitech Tap** only. It does not apply LED documentation from other Logitech products or from other parts of the Tap system.

## Verified architecture

The Cat5e Kit is a point-to-point USB extension system. It is not Ethernet and must not connect through Ethernet network equipment.[^point-to-point]

The official Cat5e setup guide and specification show this path:

1. The Tap Receiver is a removable module installed under the Tap's bottom cover.
2. The Cat5e-bundle Tap exposes **USB Type C (for Tap Receiver)**. The receiver carries the kit's power and USB data into the Tap through that connection.
3. The host computer connects by USB to the Dongle Transceiver.
4. A category cable connects the Dongle Transceiver to the power injector's **IN** port.
5. A second category cable connects the injector's **OUT** port to the Tap Receiver.
6. The power supply connects to the injector.

The guide shows these connections but does not specify a power-on or reconnection timing sequence.[^setup-guide][^cat5e-specification]

## Direct Tap connection without the Cat5e Kit

The standard, non-Cat5e Tap setup uses USB and a separate Tap power adapter.[^tap-direct-guide] That is not the package supplied with Tap Cat5e.

Logitech explicitly says Tap Cat5e purchases do not include the original Tap power adapter and that Logitech Strong USB cables will not work without that adapter.[^strong-usb]

Therefore:

- removing the Cat5e Receiver removes the Cat5e bundle's power path;
- a normal computer USB-C connection is not a documented replacement for that power path;
- Strong USB is not a supported bypass with the supplied Cat5e package.

## Synchronization

Logitech says the Tap Receiver and Dongle Transceiver synchronize automatically. No manual synchronization procedure is required.[^synchronization]

Logitech documents no host command, pairing button, or reset sequence that forces synchronization.

## Category cable requirements

Logitech includes Cat5e SF/UTP AWG 26 cable and recommends cable that meets or exceeds that specification. Its examples identify Cat6a S/FTP AWG 24 as supported and Cat5 UTP AWG 28 as unsupported.[^faq]

The maximum total category-cable distance is 40 m / 131 ft. Logitech says this total includes the USB Dongle and PoE injector.[^distance]

Logitech also documents EMI mitigations for intermittent USB behavior: shielded cable and RJ45 connectors, separation of power and data cabling, and loose rather than tight cable coils.[^emi]

## LED documentation

The only first-party Cat5e Kit LED status page found is explicitly for the **power supply**. It defines:

- green blink at a 3-second interval: normal use;
- green blink at a 5-second interval: no connection;
- fast green/yellow blink: fault detected;
- solid yellow: over-current or short detected.[^power-led]

This source does **not** document the LED on the Dongle Transceiver's RJ45 connector. Its meanings must not be applied to that LED.

The product support pages and setup guide reviewed for this note do not define the Dongle Transceiver LED patterns.

## Host software and firmware

Logitech says the Cat5e Kit itself does not require a unique driver. The Tap still requires a DisplayLink driver on the host.[^drivers]

Logitech's published update methods for the Tap Cat5e Kit use Windows Update, Logitech Sync for Windows, Sync Portal through a connected Windows host, or a Windows `.EXE` direct download. The page does not provide a macOS firmware-update method.[^firmware]

Logitech's published display and general-connection troubleshooting article is also Windows-specific. Its steps cover Tap firmware, Windows and DisplayLink updates, Windows USB selective suspend, PCI Express power management, scheduled Windows reboots, and display settings. It does not document a Cat5e synchronization or Dongle Transceiver LED procedure.[^display-troubleshooting]

## What the documentation does not establish

The reviewed first-party material does not provide:

- a meaning for a slowly fading or rapidly flashing green LED on the Dongle Transceiver;
- a startup order that guarantees USB attachment;
- a host-side reconnect procedure;
- a documented delay before the Dongle Transceiver must expose its USB device;
- a macOS-specific Cat5e Kit connection procedure;
- a way to force automatic synchronization.

Therefore, none of those behaviors should be stated as Logitech-defined behavior without another first-party source.

## Local observation boundary

The Mac trace can establish only the host side of the boundary: the USB-C connection is detected, the Mac selects Host mode, USB 2 is authorized and ready, and no USB device is present until the Cat5e Kit asserts attachment. That trace cannot identify the undocumented Dongle Transceiver LED state or prove why the kit has not asserted attachment.

[^setup-guide]: Logitech, *Tap Touch Controller with Cat5e Kit Setup Guide*, pages 8 and 10–14, linked from [Tap Setup Documentation](https://hub.sync.logitech.com/tapcat5e/post/tap-setup-documentation-6elgCzWyZITE0uu), direct PDF [download](https://files-us-east-1.t-cdn.net/files/fWVSQwnHYLPjRO9lmGty1?dl).
[^cat5e-specification]: Logitech, [Specifications - Tap](https://hub.sync.logitech.com/tapcat5e/post/specifications---tap-y96ZiQKQcGke2mB).
[^tap-direct-guide]: Logitech, *Tap Setup Guide*, pages 7 and 9, linked from [Tap Setup Documentation](https://hub.sync.logitech.com/tapcat5e/post/tap-setup-documentation-6elgCzWyZITE0uu), direct PDF [download](https://files-us-east-1.t-cdn.net/files/GV8MDTDTsLuMxzAcXbjQk?dl).
[^strong-usb]: Logitech, [What is Logitech Strong USB?](https://hub.sync.logitech.com/tapcat5e/post/what-is-logitech-strong-usb-MqjQqzxSf3ZTXVg).
[^point-to-point]: Logitech, [Is the Cat5e Kit for Logitech Tap based on the ethernet standard?](https://hub.sync.logitech.com/tapcat5e/post/is-the-cat5e-kit-for-logitech-tap-based-on-the-ethernet-ieee802-3-dtMVNIc1c1VoezN).
[^synchronization]: Logitech, [When using a custom length Cat5e, how do I synchronize the Tap Receiver and Dongle Transceiver?](https://hub.sync.logitech.com/tapcat5e/post/when-using-a-custom-length-cat5e-how-do-i-synchronize-the-tap-receiver-and-dongle-transceiver-0iXGy2pHlfFzaiL).
[^faq]: Logitech, [Common Pre-sales FAQs for Tap with Cat5e Kit](https://hub.sync.logitech.com/tapcat5e/post/common-pre-sales-faqs-for-tap-with-cat5e-kit-QcDLe271zcRGbbq).
[^distance]: Logitech, [How far can I extend the Cat5e Kit for Logitech Tap?](https://hub.sync.logitech.com/tapcat5e/post/how-far-can-i-extend-the-cat5e-kit-for-logitech-tap-MXMiQ9HX1TMjm33).
[^emi]: Logitech, [Troubleshooting USB Flickering / Interference Issues](https://hub.sync.logitech.com/tapcat5e/post/troubleshooting-usb-flickering-interference-issues-OOm2N85NIwAlutP).
[^power-led]: Logitech, [Do the LEDs on the power supply indicate specific status?](https://hub.sync.logitech.com/tapcat5e/post/do-the-leds-on-the-power-supply-indicate-specific-status-eiKcN1v2HgGCsKz).
[^drivers]: Logitech, [Do I need any Drivers for the Cat5e Kit for Logitech Tap?](https://hub.sync.logitech.com/tapcat5e/post/do-i-need-any-drivers-for-the-cat5e-kit-for-logitech-tap-mJGJKSScRpDARPZ).
[^firmware]: Logitech, [How do I update Tap firmware?](https://hub.sync.logitech.com/tapcat5e/post/how-do-i-update-tap-firmware-63lj8woZhpQ3MWq).
[^display-troubleshooting]: Logitech, [Troubleshooting Tap Cat5e Kit Display Related Issues](https://hub.sync.logitech.com/tapcat5e/post/troubleshooting-tap-cat5e-kit-display-related-issues-DTLRgtPLK50Lsay).
