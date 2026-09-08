# Dell SD25TB4 display connections

## Question

Why did moving a USB-C-to-DisplayPort monitor cable between dock ports change the Intel NUC from 4K30 to 4K60? Would a DisplayPort-to-DisplayPort cable be a better choice?

## Dell documentation

The SD25TB4 has different USB-C port types. The rear has one USB 3.2 Gen 2 (10 Gb/s) Type-C port with DisplayPort 1.4 Alt Mode (MFDP), plus two Thunderbolt 4 ports with USB4, DisplayPort 1.4, and up to 40 Gb/s data transfer. It also has two full-size DisplayPort 1.4 ports and one HDMI 2.1 port. A USB data speed does not specify the available DisplayPort bandwidth. [1][2]

Dell lists HBR3 support for the full-size DisplayPort ports. Its display resolution table supports configurations with two 4K60 monitors on those ports with a suitable Thunderbolt host. Display limits depend on host capabilities, available DisplayPort bandwidth, DSC, and monitor EDID. [2][3]

Dell lists Ubuntu 24.04, Red Hat Enterprise Linux 9.6+, and macOS among supported operating systems. This does not establish support for this exact Arch Linux/kernel/NUC combination. [2]

Dell warns that its Thunderbolt display connection requires a DSC-capable monitor for the documented DSC-dependent resolutions; resolution can otherwise be reduced. This warning does not establish that a single uncompressed 4K60 display always needs DSC. [3]

## Measurements from this session

Sources: local `boltctl list`, `hyprctl monitors -j`, `modetest -M i915 -c`, monitor EDID, Intel `i915_display_info` and connector debugfs files, and read-only DisplayPort AUX register reads.

- Host: Intel NUC11TNKi5, Iris Xe, i915, Linux 7.1.9-arch1-2.
- Monitor: Samsung LS27D80xE.
- Dock-to-host Thunderbolt link: 40 Gb/s.
- User reports the identical dock and monitor cable run 4K60 when only the host is changed to a Mac.
- Original connection, DP-3: 3840×2160 at 30 Hz; two DisplayPort lanes at 5.4 Gb/s each; no DSC. Receiver capability registers reported four lanes, but the LTTPR repeater capability register at 0xf0004 reported two.
- Clearing an existing four-lane override and requesting link retraining did not restore 4K60.
- After the user moved the monitor cable to another dock port, DP-6: 3840×2160 at 59.996 Hz; four lanes at 8.1 Gb/s on the active Intel link; DSC enabled. The connector and encoder topology changed to an MST display path.
- These are host-side link measurements. They do not establish the lane count or compression on the final dock-to-monitor cable.
- The exact physical old and new USB-C sockets were not verified. Do not label them from connector numbers alone.

The Intel driver uses the LTTPR lane limit when calculating the common lane count. Its forced lane count is also bounded by that common capability. This explains why the four-lane override could not bypass the reported two-lane limit. [4][5]

## Recommendation

For this single Samsung display, a good DisplayPort-to-DisplayPort cable from either full-size dock DisplayPort output is a sensible choice. It removes USB-C Alt Mode negotiation at the monitor cable and leaves a USB-C port free. Dell documents the necessary display capability. [1][2][3]

This is a simpler connection, not a proven performance improvement over the now-working 4K60 USB-C connection. The dock's internal display hub and host Thunderbolt link remain involved. Test 4K60 and reconnect behavior on both computers before treating it as the preferred setup.

The docs and measurements do not prove why the Mac negotiates the original connection differently. They also do not prove a specific firmware defect. Do not claim that all Linux systems or all Thunderbolt dock outputs are limited to 4K30.

## Local configuration

`~/.config/hypr/monitors.lua` now selects the Samsung by its display description, with 3840×2160 at 60 Hz, position 0x0, and scale 1.5. This avoids dependence on the changing connector name. Reload and configuration-error checks passed. The small DisplayLink screen remains at 2560x1440 with scale 1.

## Sources

1. [Dell SD25TB4/WD25TB4 user guide: Back view](https://www.dell.com/support/manuals/en-us/dell-pro-wd25tb4-dock/sd25tb4_wd25tb4_ug/back?guid=guid-cea926a5-46b7-46a6-af00-1591a0acb8f6&lang=en-us).
2. [Dell SD25TB4/WD25TB4 user guide: Product specifications](https://www.dell.com/support/manuals/en-us/dell-pro-wd25tb4-dock/sd25tb4_wd25tb4_ug/product-specifications?guid=guid-e92783ab-8d24-417f-8e54-dc898d57b8ac&lang=en-us).
3. [Dell SD25TB4 user guide: Display resolution table](https://www.dell.com/support/manuals/en-us/dell-pro-sd25tb4-dock/sd25tb4_ug/display-resolution-table?guid=guid-dd616f9d-1da4-4827-9eca-baa7abd911ba&lang=en-us).
4. [Linux v7.1 Intel DisplayPort driver: common and forced lane limits](https://github.com/torvalds/linux/blob/v7.1/drivers/gpu/drm/i915/display/intel_dp.c).
5. [Linux v7.1 DisplayPort register definitions](https://github.com/torvalds/linux/blob/v7.1/include/drm/display/drm_dp.h).
