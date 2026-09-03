import AppKit

private let launcherBackground = NSColor(
    calibratedRed: 30.0 / 255.0,
    green: 30.0 / 255.0,
    blue: 30.0 / 255.0,
    alpha: 1
)
private let primaryText = NSColor(calibratedWhite: 0.92, alpha: 1)
private let secondaryText = NSColor(calibratedWhite: 0.58, alpha: 1)
private let selectedBackground = NSColor(
    calibratedRed: 37.0 / 255.0,
    green: 37.0 / 255.0,
    blue: 38.0 / 255.0,
    alpha: 1
)
private let accentBorder = NSColor(
    calibratedRed: 86.0 / 255.0,
    green: 156.0 / 255.0,
    blue: 214.0 / 255.0,
    alpha: 1
)
private let separatorColor = NSColor(
    calibratedRed: 63.0 / 255.0,
    green: 63.0 / 255.0,
    blue: 70.0 / 255.0,
    alpha: 1
)

private struct LauncherConfiguration: Decodable {
    var exclude: [String] = []
    var aliases: [String: [String]] = [:]

    private enum CodingKeys: String, CodingKey {
        case exclude
        case aliases
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        exclude = try container.decodeIfPresent([String].self, forKey: .exclude) ?? []
        aliases = try container.decodeIfPresent([String: [String]].self, forKey: .aliases) ?? [:]
    }

    static func load() -> LauncherConfiguration {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/app-launcher/config.json")
        guard let data = try? Data(contentsOf: url),
              let configuration = try? JSONDecoder().decode(Self.self, from: data)
        else { return Self() }
        return configuration
    }
}

private enum ApplicationDiscovery {
    static func installedApplications() -> [LaunchCandidate] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var roots = [
            "/Applications",
            "/System/Applications",
            "\(home)/Applications",
            "/System/Library/CoreServices/Applications",
        ]
        if let developerApplicationsRoot {
            roots.append(developerApplicationsRoot)
        }

        var applications: [LaunchCandidate] = []
        var seenPaths = Set<String>()

        let finderPath = "/System/Library/CoreServices/Finder.app"
        if FileManager.default.fileExists(atPath: finderPath) {
            seenPaths.insert(finderPath)
            applications.append(candidate(at: URL(fileURLWithPath: finderPath), name: "Finder"))
        }

        for root in roots where FileManager.default.fileExists(atPath: root) {
            guard let enumerator = FileManager.default.enumerator(
                at: URL(fileURLWithPath: root),
                includingPropertiesForKeys: [.isApplicationKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            ) else { continue }

            for case let url as URL in enumerator where url.pathExtension.lowercased() == "app" {
                let path = url.standardizedFileURL.path
                guard seenPaths.insert(path).inserted else { continue }
                applications.append(candidate(at: url, name: applicationName(at: url)))
            }
        }
        return applications
    }

    private static var developerApplicationsRoot: String? {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
        process.arguments = ["-p"]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0,
                  let developerDirectory = String(
                    data: output.fileHandleForReading.readDataToEndOfFile(),
                    encoding: .utf8
                  )?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !developerDirectory.isEmpty
            else { return nil }
            return URL(fileURLWithPath: developerDirectory)
                .appendingPathComponent("Applications")
                .path
        } catch {
            return nil
        }
    }

    private static func candidate(at url: URL, name: String) -> LaunchCandidate {
        LaunchCandidate(
            name: name,
            path: url.standardizedFileURL.path,
            iconVersion: iconVersion(at: url)
        )
    }

    private static func iconVersion(at applicationURL: URL) -> String {
        let bundle = Bundle(url: applicationURL)
        let resourcesURL = applicationURL.appendingPathComponent("Contents/Resources")
        var inputs = [
            applicationURL,
            applicationURL.appendingPathComponent("Contents/Info.plist"),
            resourcesURL.appendingPathComponent("Assets.car"),
        ]

        if let iconFile = bundle?.object(forInfoDictionaryKey: "CFBundleIconFile") as? String {
            let iconName = iconFile.hasSuffix(".icns") ? iconFile : "\(iconFile).icns"
            inputs.append(resourcesURL.appendingPathComponent(iconName))
        }

        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey]
        return inputs.map { input in
            let values = try? input.resourceValues(forKeys: keys)
            let modifiedAt = values?.contentModificationDate?.timeIntervalSinceReferenceDate ?? 0
            let size = values?.fileSize ?? 0
            return "\(input.path):\(modifiedAt):\(size)"
        }.joined(separator: "|")
    }

    private static func applicationName(at url: URL) -> String {
        if let bundle = Bundle(url: url),
           let displayName = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String {
            return displayName
        }
        return url.deletingPathExtension().lastPathComponent
    }
}

private enum AeroSpaceClient {
    private static let executablePaths = [
        "/opt/homebrew/bin/aerospace",
        "/usr/local/bin/aerospace",
    ]

    static func windowIDs(bundleIdentifier: String) -> [String]? {
        guard let output = run([
            "list-windows", "--all", "--format", "%{window-id}|%{app-bundle-id}",
        ]) else { return nil }

        return output.split(separator: "\n").compactMap { line in
            let fields = line.split(separator: "|", maxSplits: 1).map(String.init)
            guard fields.count == 2, fields[1] == bundleIdentifier else { return nil }
            return fields[0]
        }
    }

    static func focus(windowID: String) {
        _ = run(["focus", "--window-id", windowID])
    }

    @discardableResult
    private static func run(_ arguments: [String]) -> String? {
        guard let path = executablePaths.first(where: FileManager.default.isExecutableFile(atPath:)) else {
            report("cannot find the aerospace executable")
            return nil
        }

        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)
        } catch {
            report("aerospace command failed: \(error)")
            return nil
        }
    }

    private static func report(_ message: String) {
        guard let data = "app-launcher: \(message)\n".data(using: .utf8) else { return }
        FileHandle.standardError.write(data)
    }
}

private final class ApplicationLaunchCoordinator {
    private static let pollInterval: TimeInterval = 0.1
    private static let timeout: TimeInterval = 15

    private let operationLock = NSLock()
    private var activeOperationID: UUID?

    func cancel() {
        operationLock.withLock { activeOperationID = nil }
    }

    func perform(
        action: ApplicationLaunchAction,
        applicationURL: URL,
        bundleIdentifier: String,
        existingWindowIDs: Set<String>,
        completion: @escaping () -> Void
    ) {
        cancel()
        switch action {
        case .focusExistingWindow:
            open(applicationURL, activates: true)
        case .openWindowInCurrentWorkspace:
            // AeroSpace assigns a new window to focus.workspace. Keep the
            // launcher key until the application activates and creates it.
            open(applicationURL, activates: true)
        case .createWindowInCurrentWorkspace:
            let operationID = UUID()
            operationLock.withLock { activeOperationID = operationID }
            open(applicationURL, activates: false) { [weak self] runningApplication in
                guard let self, self.isActive(operationID) else { return }
                guard let runningApplication else {
                    self.finish(operationID: operationID, completion: completion)
                    return
                }
                guard self.requestNewWindow(
                    processIdentifier: runningApplication.processIdentifier,
                    operationID: operationID
                ) else {
                    self.finish(operationID: operationID, completion: completion)
                    return
                }
                self.waitForNewWindows(
                    bundleIdentifier: bundleIdentifier,
                    existingWindowIDs: existingWindowIDs,
                    operationID: operationID,
                    completion: completion
                )
            }
        }
    }

    private func open(
        _ applicationURL: URL,
        activates: Bool,
        completion: ((NSRunningApplication?) -> Void)? = nil
    ) {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = activates
        NSWorkspace.shared.openApplication(at: applicationURL, configuration: configuration) {
            application, error in
            if let error {
                Self.report("could not open \(applicationURL.lastPathComponent): \(error)")
            }
            completion?(application)
        }
    }

    private func waitForNewWindows(
        bundleIdentifier: String,
        existingWindowIDs: Set<String>,
        operationID: UUID,
        completion: @escaping () -> Void
    ) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let startedAt = Date()

            while Date().timeIntervalSince(startedAt) < Self.timeout {
                guard self.isActive(operationID) else { return }
                if let windowIDs = AeroSpaceClient.windowIDs(bundleIdentifier: bundleIdentifier),
                   let newWindowID = windowIDs.first(where: { !existingWindowIDs.contains($0) }) {
                    self.focusAndFinish(
                        windowID: newWindowID,
                        operationID: operationID,
                        completion: completion
                    )
                    return
                }

                Thread.sleep(forTimeInterval: Self.pollInterval)
            }
            Self.report("timed out waiting for a window from \(bundleIdentifier)")
            self.finish(operationID: operationID, completion: completion)
        }
    }

    private func isActive(_ operationID: UUID) -> Bool {
        operationLock.withLock { activeOperationID == operationID }
    }

    private func focusAndFinish(
        windowID: String,
        operationID: UUID,
        completion: @escaping () -> Void
    ) {
        let mustScheduleCompletion = operationLock.withLock {
            guard activeOperationID == operationID else { return false }
            AeroSpaceClient.focus(windowID: windowID)
            return true
        }
        if mustScheduleCompletion {
            scheduleCompletion(operationID: operationID, completion: completion)
        }
    }

    private func finish(operationID: UUID, completion: @escaping () -> Void) {
        if isActive(operationID) {
            scheduleCompletion(operationID: operationID, completion: completion)
        }
    }

    private func scheduleCompletion(operationID: UUID, completion: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let mustComplete = self.operationLock.withLock {
                guard self.activeOperationID == operationID else { return false }
                self.activeOperationID = nil
                return true
            }
            if mustComplete {
                completion()
            }
        }
    }

    private func requestNewWindow(processIdentifier: pid_t, operationID: UUID) -> Bool {
        guard CGPreflightPostEventAccess() || CGRequestPostEventAccess() else {
            Self.report("event access is required to request a new application window")
            return false
        }

        return operationLock.withLock {
            guard activeOperationID == operationID else { return false }
            let source = CGEventSource(stateID: .hidSystemState)
            let keyCodeForN: CGKeyCode = 45
            let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCodeForN, keyDown: true)
            let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCodeForN, keyDown: false)
            keyDown?.flags = .maskCommand
            keyUp?.flags = .maskCommand
            keyDown?.postToPid(processIdentifier)
            keyUp?.postToPid(processIdentifier)
            return true
        }
    }

    private static func report(_ message: String) {
        guard let data = "app-launcher: \(message)\n".data(using: .utf8) else { return }
        FileHandle.standardError.write(data)
    }
}

private final class ApplicationIconCache {
    private struct Version: Equatable {
        let value: String
    }

    private let loadQueue = DispatchQueue(label: "app-launcher.icon-loader", qos: .utility)
    private var icons: [String: NSImage] = [:]
    private var versions: [String: Version] = [:]
    private var pendingPaths = Set<String>()
    var didLoadIcon: ((String) -> Void)?

    func refresh(_ applications: [LaunchCandidate]) {
        dispatchPrecondition(condition: .onQueue(.main))

        let activePaths = Set(applications.map(\.path))
        icons = icons.filter { activePaths.contains($0.key) }
        versions = versions.filter { activePaths.contains($0.key) }

        for application in applications {
            let version = Version(value: application.iconVersion)
            if versions[application.path] != version {
                icons.removeValue(forKey: application.path)
                versions[application.path] = version
            }
            loadIfNeeded(path: application.path, version: version)
        }
    }

    func icon(for path: String) -> NSImage? {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let version = versions[path] else { return nil }
        loadIfNeeded(path: path, version: version)
        return icons[path]
    }

    private func loadIfNeeded(path: String, version: Version) {
        guard icons[path] == nil, pendingPaths.insert(path).inserted else { return }

        loadQueue.async { [weak self] in
            let icon = autoreleasepool {
                Self.rasterizedIcon(forFile: path)
            }

            DispatchQueue.main.async {
                guard let self else { return }
                self.pendingPaths.remove(path)
                guard self.versions[path] == version else {
                    if let currentVersion = self.versions[path] {
                        self.loadIfNeeded(path: path, version: currentVersion)
                    }
                    return
                }
                self.icons[path] = icon
                self.didLoadIcon?(path)
            }
        }
    }

    private static func rasterizedIcon(forFile path: String) -> NSImage {
        let pointSize = NSSize(width: 28, height: 28)
        let pixelSize = 56
        let source = NSWorkspace.shared.icon(forFile: path)
        var sourceRect = NSRect(origin: .zero, size: pointSize)

        guard let sourceImage = source.cgImage(
            forProposedRect: &sourceRect,
            context: nil,
            hints: nil
        ),
        let context = CGContext(
            data: nil,
            width: pixelSize,
            height: pixelSize,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            source.size = pointSize
            return source
        }

        context.interpolationQuality = .high
        context.draw(
            sourceImage,
            in: CGRect(x: 0, y: 0, width: pixelSize, height: pixelSize)
        )
        guard let rasterizedImage = context.makeImage() else {
            source.size = pointSize
            return source
        }
        return NSImage(cgImage: rasterizedImage, size: pointSize)
    }
}

private final class LauncherPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private final class LauncherRowView: NSTableRowView {
    override func drawSelection(in dirtyRect: NSRect) {
        guard selectionHighlightStyle != .none else { return }
        selectedBackground.setFill()
        dirtyRect.fill()
    }
}

private final class LauncherController: NSObject, NSTextFieldDelegate, NSTableViewDataSource, NSTableViewDelegate {
    private static let width: CGFloat = 560
    private static let searchHeight: CGFloat = 52
    private static let rowHeight: CGFloat = 44
    private static let visibleRows = 8

    private static func panelHeight(resultCount: Int) -> CGFloat {
        let rowCount = max(min(resultCount, visibleRows), 1)
        return searchHeight + CGFloat(rowCount) * rowHeight + 1
    }

    private let panel: LauncherPanel
    private let focusSinkPanel: LauncherPanel
    private let searchContainer = NSView()
    private let searchIcon = NSImageView()
    private let separator = NSView()
    private let input = NSTextField()
    private let table = NSTableView()
    private let scrollView = NSScrollView()
    private var applications: [LaunchCandidate] = []
    private var results: [LaunchCandidate] = []
    private var excludedApplications: [String] = []
    private var aliases: [String: [String]] = [:]
    private let launchCoordinator = ApplicationLaunchCoordinator()
    private let iconCache = ApplicationIconCache()
    private let placeholderIcon = NSImage(
        systemSymbolName: "app.dashed",
        accessibilityDescription: "Application"
    )

    override init() {
        panel = LauncherPanel(
            contentRect: .zero,
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: true
        )
        focusSinkPanel = LauncherPanel(
            contentRect: NSRect(x: 0, y: 0, width: 1, height: 1),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        super.init()
        applications = ApplicationDiscovery.installedApplications()
        configurePanel()
        configureFocusSinkPanel()
        configureInput()
        configureTable()
        layoutViews()
        iconCache.didLoadIcon = { [weak self] path in
            self?.reloadIcon(forApplicationAt: path)
        }
        iconCache.refresh(applications)
    }

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    func hide() {
        panel.orderOut(nil)
        focusSinkPanel.orderOut(nil)
        NSApp.hide(nil)
    }

    func focusSink() {
        launchCoordinator.cancel()
        panel.orderOut(nil)
        NSApp.unhide(nil)
        focusSinkPanel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        focusSinkPanel.makeKey()
    }

    private func show() {
        launchCoordinator.cancel()
        focusSinkPanel.orderOut(nil)
        let configuration = LauncherConfiguration.load()
        excludedApplications = configuration.exclude
        aliases = configuration.aliases
        input.stringValue = ""
        updateResults()
        positionPanel()
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(input)
        scrollResultsToTop()
        refreshApplications()
    }

    private func refreshApplications() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let applications = ApplicationDiscovery.installedApplications()
            DispatchQueue.main.async {
                guard let self else { return }
                let selectedPath = self.selectedApplicationPath
                self.applications = applications
                self.iconCache.refresh(applications)
                if self.panel.isVisible {
                    self.updateResults(selecting: selectedPath, resetScrollPosition: false)
                }
            }
        }
    }

    private func configurePanel() {
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = true
        panel.isOpaque = true
        panel.backgroundColor = launcherBackground
        panel.hasShadow = false
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.contentView?.wantsLayer = true
        panel.contentView?.layer?.backgroundColor = launcherBackground.cgColor
        panel.contentView?.layer?.cornerRadius = 0
        panel.contentView?.layer?.borderWidth = 1
        panel.contentView?.layer?.borderColor = accentBorder.cgColor
    }

    private func configureFocusSinkPanel() {
        focusSinkPanel.isOpaque = true
        focusSinkPanel.backgroundColor = launcherBackground
        focusSinkPanel.hasShadow = false
        focusSinkPanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        focusSinkPanel.hidesOnDeactivate = false
        focusSinkPanel.ignoresMouseEvents = true
        focusSinkPanel.level = .floating
    }

    private func configureInput() {
        input.delegate = self
        input.isBezeled = false
        input.isBordered = false
        input.drawsBackground = false
        input.focusRingType = .none
        input.font = NSFont.monospacedSystemFont(ofSize: 20, weight: .medium)
        input.textColor = primaryText
        input.placeholderString = ""
        input.cell?.wraps = false
        input.cell?.isScrollable = true

        searchIcon.image = NSImage(systemSymbolName: "magnifyingglass", accessibilityDescription: nil)
        searchIcon.contentTintColor = secondaryText
        searchIcon.imageScaling = .scaleProportionallyDown
        searchContainer.wantsLayer = true
        searchContainer.layer?.backgroundColor = launcherBackground.cgColor
        separator.wantsLayer = true
        separator.layer?.backgroundColor = separatorColor.cgColor
    }

    private func configureTable() {
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("application"))
        column.width = Self.width - 2
        table.addTableColumn(column)
        table.headerView = nil
        table.style = .plain
        table.backgroundColor = launcherBackground
        table.selectionHighlightStyle = .regular
        table.rowHeight = Self.rowHeight
        table.intercellSpacing = .zero
        table.dataSource = self
        table.delegate = self
        table.target = self
        table.doubleAction = #selector(activateSelectedApplication)

        scrollView.documentView = table
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.hasHorizontalScroller = false
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.contentInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        scrollView.scrollerInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        scrollView.borderType = .noBorder
    }

    private func layoutViews() {
        guard let contentView = panel.contentView else { return }
        searchContainer.translatesAutoresizingMaskIntoConstraints = false
        searchIcon.translatesAutoresizingMaskIntoConstraints = false
        separator.translatesAutoresizingMaskIntoConstraints = false
        input.translatesAutoresizingMaskIntoConstraints = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(searchContainer)
        searchContainer.addSubview(searchIcon)
        searchContainer.addSubview(input)
        searchContainer.addSubview(separator)
        contentView.addSubview(scrollView)

        NSLayoutConstraint.activate([
            searchContainer.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 1),
            searchContainer.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -1),
            searchContainer.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 1),
            searchContainer.heightAnchor.constraint(equalToConstant: Self.searchHeight - 1),
            searchIcon.leadingAnchor.constraint(equalTo: searchContainer.leadingAnchor, constant: 16),
            searchIcon.centerYAnchor.constraint(equalTo: searchContainer.centerYAnchor),
            searchIcon.widthAnchor.constraint(equalToConstant: 24),
            searchIcon.heightAnchor.constraint(equalToConstant: 24),
            input.leadingAnchor.constraint(equalTo: searchIcon.trailingAnchor, constant: 16),
            input.trailingAnchor.constraint(equalTo: searchContainer.trailingAnchor, constant: -15),
            input.centerYAnchor.constraint(equalTo: searchContainer.centerYAnchor),
            input.heightAnchor.constraint(equalToConstant: 28),
            separator.leadingAnchor.constraint(equalTo: searchContainer.leadingAnchor),
            separator.trailingAnchor.constraint(equalTo: searchContainer.trailingAnchor),
            separator.bottomAnchor.constraint(equalTo: searchContainer.bottomAnchor),
            separator.heightAnchor.constraint(equalToConstant: 1),
            scrollView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 1),
            scrollView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -1),
            scrollView.topAnchor.constraint(equalTo: searchContainer.bottomAnchor),
            scrollView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -1),
        ])
    }

    func controlTextDidChange(_ notification: Notification) {
        updateResults()
    }

    func control(
        _ control: NSControl,
        textView: NSTextView,
        doCommandBy commandSelector: Selector
    ) -> Bool {
        switch commandSelector {
        case #selector(NSResponder.insertNewline(_:)),
             #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
            let intent: LaunchIntent = NSApp.currentEvent?.modifierFlags.contains(.shift) == true
                ? .newWindow
                : .open
            launchSelection(intent: intent)
        case #selector(NSResponder.cancelOperation(_:)):
            hide()
        case #selector(NSResponder.moveUp(_:)):
            moveSelection(by: -1)
        case #selector(NSResponder.moveDown(_:)):
            moveSelection(by: 1)
        default:
            return false
        }
        return true
    }

    private var selectedApplicationPath: String? {
        guard results.indices.contains(table.selectedRow) else { return nil }
        return results[table.selectedRow].path
    }

    private func updateResults(
        selecting selectedPath: String? = nil,
        resetScrollPosition: Bool = true
    ) {
        results = ApplicationMatcher.rank(
            query: input.stringValue,
            candidates: applications,
            aliases: aliases,
            excluding: excludedApplications
        ).map(\.candidate)

        table.reloadData()
        if results.isEmpty {
            table.deselectAll(nil)
        } else {
            let selectedRow = selectedPath.flatMap { path in
                results.firstIndex(where: { $0.path == path })
            } ?? 0
            table.selectRowIndexes(IndexSet(integer: selectedRow), byExtendingSelection: false)
        }
        resizePanel()
        if resetScrollPosition {
            scrollResultsToTop()
        }
    }

    private func scrollResultsToTop() {
        scrollView.contentView.setBoundsOrigin(.zero)
        scrollView.reflectScrolledClipView(scrollView.contentView)
        if !results.isEmpty {
            table.scrollRowToVisible(0)
        }
    }

    private func resizePanel() {
        let height = Self.panelHeight(resultCount: results.count)
        var frame = panel.frame
        let oldTop = frame.maxY
        frame.size = NSSize(width: Self.width, height: height)
        frame.origin.y = oldTop - height
        panel.setFrame(frame, display: true)
    }

    private func positionPanel() {
        let mouseLocation = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { $0.frame.contains(mouseLocation) }) ?? NSScreen.main
        guard let screen else { return }
        let height = Self.panelHeight(resultCount: results.count)
        let frame = NSRect(
            x: screen.frame.midX - Self.width / 2,
            y: screen.frame.maxY - screen.visibleFrame.height * 0.22 - height,
            width: Self.width,
            height: height
        )
        panel.setFrame(frame, display: true)
    }

    private func moveSelection(by offset: Int) {
        guard !results.isEmpty else { return }
        let current = max(table.selectedRow, 0)
        let next = min(max(current + offset, 0), results.count - 1)
        table.selectRowIndexes(IndexSet(integer: next), byExtendingSelection: false)
        table.scrollRowToVisible(next)
    }

    @objc private func activateSelectedApplication() {
        launchSelection(intent: .open)
    }

    private func launchSelection(intent: LaunchIntent) {
        guard !results.isEmpty else { return }
        let index = table.selectedRow >= 0 ? table.selectedRow : 0
        let application = results[index]
        let applicationURL = URL(fileURLWithPath: application.path)
        guard let bundleIdentifier = Bundle(url: applicationURL)?.bundleIdentifier,
              let windowIDs = AeroSpaceClient.windowIDs(bundleIdentifier: bundleIdentifier)
        else {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            NSWorkspace.shared.openApplication(at: applicationURL, configuration: configuration)
            return
        }

        let existingWindowIDs = Set(windowIDs)
        let isRunning = !NSRunningApplication.runningApplications(
            withBundleIdentifier: bundleIdentifier
        ).isEmpty
        let action = ApplicationLaunchPolicy.action(
            intent: intent,
            isRunning: isRunning,
            existingWindowCount: existingWindowIDs.count
        )

        if action == .focusExistingWindow {
            hide()
        }
        launchCoordinator.perform(
            action: action,
            applicationURL: applicationURL,
            bundleIdentifier: bundleIdentifier,
            existingWindowIDs: existingWindowIDs
        ) { [weak self] in
            self?.hide()
        }
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        results.count
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        LauncherRowView()
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let identifier = NSUserInterfaceItemIdentifier("application-cell")
        let cell = (tableView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView)
            ?? makeApplicationCell(identifier: identifier)
        let application = results[row]
        cell.textField?.stringValue = application.name
        cell.imageView?.image = iconCache.icon(for: application.path) ?? placeholderIcon
        return cell
    }

    private func reloadIcon(forApplicationAt path: String) {
        guard panel.isVisible,
              let row = results.firstIndex(where: { $0.path == path }),
              table.rowView(atRow: row, makeIfNecessary: false) != nil
        else { return }
        table.reloadData(
            forRowIndexes: IndexSet(integer: row),
            columnIndexes: IndexSet(integer: 0)
        )
    }

    private func makeApplicationCell(identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier

        let icon = NSImageView()
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.imageScaling = .scaleProportionallyUpOrDown

        let label = NSTextField(labelWithString: "")
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = NSFont.systemFont(ofSize: 15, weight: .medium)
        label.textColor = secondaryText
        label.lineBreakMode = .byTruncatingTail

        cell.imageView = icon
        cell.textField = label
        cell.addSubview(icon)
        cell.addSubview(label)

        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 16),
            icon.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 28),
            icon.heightAnchor.constraint(equalToConstant: 28),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -16),
            label.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }
}

private final class LauncherDelegate: NSObject, NSApplicationDelegate {
    private let launcher = LauncherController()
    private var toggleSignal: DispatchSourceSignal?
    private var focusSinkSignal: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        installToggleSignal()
        installFocusSinkSignal()
    }

    func toggleLauncher() {
        launcher.toggle()
    }

    private func installToggleSignal() {
        signal(SIGUSR1, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        source.setEventHandler { [weak self] in self?.toggleLauncher() }
        source.resume()
        toggleSignal = source
    }

    private func installFocusSinkSignal() {
        signal(SIGUSR2, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGUSR2, queue: .main)
        source.setEventHandler { [weak self] in self?.launcher.focusSink() }
        source.resume()
        focusSinkSignal = source
    }
}

private let application = NSApplication.shared
private let delegate = LauncherDelegate()
application.delegate = delegate
application.run()
