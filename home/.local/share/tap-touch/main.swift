import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import IOKit.hid

setbuf(stdout, nil)
setbuf(stderr, nil)

private let tapVendorID = 0x222a
private let tapProductID = 0x0001
private let touchReportID: UInt32 = 4
private let xMaximum = 16_384.0
private let yMaximum = 9_600.0
private let pointerGestureDelay = 0.075
private let pointerDragThreshold = 4.0
private let scrollArmingDelay = 0.03
private let scrollSensitivity = 1.0

private struct Options {
    var displayName = "FLARE"
    var debug = false
    var flipY = false

    static func parse() -> Options {
        var options = Options()
        var arguments = Array(CommandLine.arguments.dropFirst())

        while !arguments.isEmpty {
            switch arguments.removeFirst() {
            case "--display":
                guard let name = arguments.first else {
                    fatalError("--display requires a display name")
                }
                options.displayName = name
                arguments.removeFirst()
            case "--debug":
                options.debug = true
            case "--flip-y":
                options.flipY = true
            case "--help", "-h":
                print("Usage: tap-touch [--display FLARE] [--flip-y] [--debug]")
                exit(0)
            default:
                fatalError("Unknown option")
            }
        }
        return options
    }
}

private struct ContactState {
    var identifier: UInt8 = 0
    var isTouching = false
    var x = 0.0
    var y = 0.0
    var hasX = false
    var hasY = false
}

private final class TouchMapper {
    private let options: Options
    private var displayBounds: CGRect?
    private var contacts: [IOHIDElementCookie: ContactState] = [:]
    private var activeCollection: IOHIDElementCookie?
    private var pendingCollection: IOHIDElementCookie?
    private var pendingStartPoint: CGPoint?
    private var pendingTimer: Timer?
    private var gestureUpdateTimer: Timer?
    private var changedCollections: Set<IOHIDElementCookie> = []
    private var lastPoint = CGPoint.zero
    private var isScrolling = false
    private var lastScrollCentroid: CGPoint?
    private var scrollReadyAt = 0.0
    private var scrollRemainder = CGPoint.zero
    private var suppressPointerUntilRelease = false

    init(options: Options) {
        self.options = options
        refreshDisplay()
    }

    func refreshDisplay() {
        guard let screen = NSScreen.screens.first(where: {
            $0.localizedName.localizedCaseInsensitiveCompare(options.displayName) == .orderedSame
        }), let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else {
            if displayBounds != nil {
                cancel()
                print("Waiting for display '\(options.displayName)'...")
            }
            displayBounds = nil
            return
        }

        let bounds = CGDisplayBounds(displayID)
        guard CGDisplayIsOnline(displayID) != 0, bounds.width > 0, bounds.height > 0 else {
            return
        }

        if displayBounds != bounds {
            displayBounds = bounds
            print("Mapping ILITEK-TP touch to \(screen.localizedName) at \(bounds)")
        }
    }

    func cancel() {
        gestureUpdateTimer?.invalidate()
        gestureUpdateTimer = nil
        changedCollections.removeAll()
        cancelPendingPointer()
        releasePointer()
        isScrolling = false
        lastScrollCentroid = nil
        scrollReadyAt = 0
        scrollRemainder = .zero
        suppressPointerUntilRelease = false
        contacts.removeAll()
    }

    func handle(value: IOHIDValue) {
        let element = IOHIDValueGetElement(value)
        guard IOHIDElementGetReportID(element) == touchReportID,
              let collection = IOHIDElementGetParent(element) else { return }

        let cookie = IOHIDElementGetCookie(collection)
        var contact = contacts[cookie] ?? ContactState()
        let usagePage = IOHIDElementGetUsagePage(element)
        let usage = IOHIDElementGetUsage(element)
        let integerValue = IOHIDValueGetIntegerValue(value)

        var updateGesture = true
        switch (usagePage, usage) {
        case (0x0d, 0x42): // Tip Switch
            let isTouching = integerValue != 0
            if contact.isTouching != isTouching, gestureUpdateTimer != nil {
                flushGestureUpdates()
            }
            contact.isTouching = isTouching
        case (0x0d, 0x51): // Contact Identifier
            contact.identifier = UInt8(clamping: integerValue)
            updateGesture = false
        case (0x01, 0x30): // X
            contact.x = Double(integerValue)
            contact.hasX = true
        case (0x01, 0x31): // Y
            contact.y = Double(integerValue)
            contact.hasY = true
        default:
            updateGesture = false
        }

        contacts[cookie] = contact
        if updateGesture {
            scheduleGestureUpdate(for: cookie)
        }
    }

    private func scheduleGestureUpdate(for cookie: IOHIDElementCookie) {
        changedCollections.insert(cookie)
        guard gestureUpdateTimer == nil else { return }

        gestureUpdateTimer = Timer.scheduledTimer(withTimeInterval: 0.001, repeats: false) { [weak self] _ in
            self?.flushGestureUpdates()
        }
    }

    private func flushGestureUpdates() {
        gestureUpdateTimer?.invalidate()
        gestureUpdateTimer = nil
        guard !changedCollections.isEmpty else { return }

        let changed = changedCollections
        changedCollections.removeAll()
        updateGestureState(changedCollections: changed)
    }

    private func updateGestureState(changedCollections: Set<IOHIDElementCookie>) {
        let touching = contacts
            .filter { $0.value.isTouching && $0.value.hasX && $0.value.hasY }
            .sorted { $0.key < $1.key }

        if touching.count >= 2 {
            let points = touching.prefix(2).compactMap { map($0.value) }
            guard points.count == 2 else { return }

            cancelPendingPointer()
            releasePointer()
            let centroid = CGPoint(
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            )
            let now = ProcessInfo.processInfo.systemUptime
            if isScrolling, let previous = lastScrollCentroid {
                if now >= scrollReadyAt {
                    postScroll(delta: CGPoint(x: centroid.x - previous.x, y: centroid.y - previous.y))
                }
            } else {
                isScrolling = true
                scrollReadyAt = now + scrollArmingDelay
                scrollRemainder = .zero
                lastPoint = centroid
                post(type: .mouseMoved, at: centroid)
                if options.debug { print("scroll start point=\(centroid)") }
            }
            lastScrollCentroid = centroid
            return
        }

        if isScrolling {
            isScrolling = false
            lastScrollCentroid = nil
            scrollReadyAt = 0
            scrollRemainder = .zero
            suppressPointerUntilRelease = !touching.isEmpty
            if options.debug { print("scroll end") }
        }

        guard let (cookie, contact) = touching.first else {
            if let pendingCollection, let pending = contacts[pendingCollection],
               !suppressPointerUntilRelease, let point = map(pending) {
                post(type: .mouseMoved, at: point)
                post(type: .leftMouseDown, at: point)
                post(type: .leftMouseUp, at: point)
                if options.debug { print("tap id=\(pending.identifier) point=\(point)") }
            }
            cancelPendingPointer()
            releasePointer()
            suppressPointerUntilRelease = false
            return
        }
        guard !suppressPointerUntilRelease, let point = map(contact) else { return }

        if activeCollection == nil {
            if pendingCollection == nil {
                pendingCollection = cookie
                pendingStartPoint = point
                pendingTimer = Timer.scheduledTimer(withTimeInterval: pointerGestureDelay, repeats: false) { [weak self] _ in
                    self?.beginPendingPointer()
                }
            } else if pendingCollection == cookie, let start = pendingStartPoint,
                      hypot(point.x - start.x, point.y - start.y) >= pointerDragThreshold {
                beginPendingPointer(at: start)
                post(type: .leftMouseDragged, at: point)
                if options.debug { print("drag id=\(contact.identifier) point=\(point)") }
            }
        } else if activeCollection == cookie, changedCollections.contains(cookie) {
            post(type: .leftMouseDragged, at: point)
            if options.debug { print("drag id=\(contact.identifier) point=\(point)") }
        }
        lastPoint = point
    }

    private func beginPendingPointer(at requestedPoint: CGPoint? = nil) {
        guard let cookie = pendingCollection else { return }
        pendingCollection = nil
        pendingStartPoint = nil
        pendingTimer?.invalidate()
        pendingTimer = nil
        guard !isScrolling, !suppressPointerUntilRelease,
              let contact = contacts[cookie], contact.isTouching,
              let point = requestedPoint ?? map(contact) else { return }

        activeCollection = cookie
        lastPoint = point
        post(type: .mouseMoved, at: point)
        post(type: .leftMouseDown, at: point)
        if options.debug { print("down id=\(contact.identifier) point=\(point)") }
    }

    private func cancelPendingPointer() {
        pendingTimer?.invalidate()
        pendingTimer = nil
        pendingCollection = nil
        pendingStartPoint = nil
    }

    private func releasePointer() {
        guard activeCollection != nil else { return }
        post(type: .leftMouseUp, at: lastPoint)
        activeCollection = nil
        if options.debug { print("up point=\(lastPoint)") }
    }

    private func postScroll(delta: CGPoint) {
        scrollRemainder.x += delta.x * scrollSensitivity
        scrollRemainder.y += delta.y * scrollSensitivity
        let horizontal = Int32(scrollRemainder.x.rounded(.towardZero))
        let vertical = Int32(scrollRemainder.y.rounded(.towardZero))
        guard horizontal != 0 || vertical != 0 else { return }

        scrollRemainder.x -= CGFloat(horizontal)
        scrollRemainder.y -= CGFloat(vertical)
        CGEvent(
            scrollWheelEvent2Source: nil,
            units: .pixel,
            wheelCount: 2,
            wheel1: vertical,
            wheel2: horizontal,
            wheel3: 0
        )?.post(tap: .cghidEventTap)
        if options.debug { print("scroll dx=\(horizontal) dy=\(vertical)") }
    }

    private func map(_ contact: ContactState) -> CGPoint? {
        guard let displayBounds else { return nil }

        let normalizedX = min(max(contact.x / xMaximum, 0), 1)
        var normalizedY = min(max(contact.y / yMaximum, 0), 1)
        if options.flipY { normalizedY = 1 - normalizedY }

        return CGPoint(
            x: displayBounds.minX + normalizedX * displayBounds.width,
            y: displayBounds.minY + normalizedY * displayBounds.height
        )
    }

    private func post(type: CGEventType, at point: CGPoint) {
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    }
}

private let options = Options.parse()
private let trustPrompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(trustPrompt) {
    fputs("Allow tap-touch in System Settings > Privacy & Security > Accessibility, then run it again.\n", stderr)
    exit(1)
}

// Initialize AppKit's display-change handling before NSScreen is queried.
_ = NSApplication.shared

private let mapper = TouchMapper(options: options)
_ = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
    mapper.refreshDisplay()
}
private let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
let matching: [String: Any] = [
    kIOHIDVendorIDKey as String: tapVendorID,
    kIOHIDProductIDKey as String: tapProductID,
]
IOHIDManagerSetDeviceMatching(manager, matching as CFDictionary)
IOHIDManagerRegisterInputValueCallback(manager, { _, result, _, value in
    guard result == kIOReturnSuccess else { return }
    mapper.handle(value: value)
}, nil)
IOHIDManagerRegisterDeviceMatchingCallback(manager, { _, result, _, device in
    guard result == kIOReturnSuccess else {
        fputs("HID matching failed: 0x\(String(UInt32(bitPattern: result), radix: 16))\n", stderr)
        return
    }

    let claimResult = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeSeizeDevice))
    guard claimResult == kIOReturnSuccess else {
        fputs("Could not reclaim touch device: 0x\(String(UInt32(bitPattern: claimResult), radix: 16))\n", stderr)
        return
    }

    let product = IOHIDDeviceGetProperty(device, kIOHIDProductKey as CFString) as? String ?? "touch device"
    print("Connected to and reclaimed \(product)")
}, nil)
IOHIDManagerRegisterDeviceRemovalCallback(manager, { _, _, _, _ in
    mapper.cancel()
    print("Touch device disconnected")
}, nil)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)

let result = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeSeizeDevice))
guard result == kIOReturnSuccess else {
    fatalError("Could not open the HID manager: 0x\(String(UInt32(bitPattern: result), radix: 16))")
}

print("tap-touch is running. Press Control-C to stop.")
CFRunLoopRun()
