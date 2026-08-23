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
        let roots = [
            "/Applications",
            "/System/Applications",
            "\(home)/Applications",
            "/System/Library/CoreServices/Applications",
        ]

        var applications: [LaunchCandidate] = []
        var seenPaths = Set<String>()

        let finderPath = "/System/Library/CoreServices/Finder.app"
        if FileManager.default.fileExists(atPath: finderPath) {
            seenPaths.insert(finderPath)
            applications.append(LaunchCandidate(name: "Finder", path: finderPath))
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
                applications.append(LaunchCandidate(name: applicationName(at: url), path: path))
            }
        }
        return applications
    }

    private static func applicationName(at url: URL) -> String {
        if let bundle = Bundle(url: url),
           let displayName = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String {
            return displayName
        }
        return url.deletingPathExtension().lastPathComponent
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

    override init() {
        panel = LauncherPanel(
            contentRect: .zero,
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: true
        )
        super.init()
        applications = ApplicationDiscovery.installedApplications()
        configurePanel()
        configureInput()
        configureTable()
        layoutViews()
    }

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    func hide() {
        panel.orderOut(nil)
        NSApp.hide(nil)
    }

    private func show() {
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
        table.doubleAction = #selector(launchSelection)

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
        case #selector(NSResponder.insertNewline(_:)):
            launchSelection()
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

    @objc private func launchSelection() {
        guard !results.isEmpty else { return }
        let index = table.selectedRow >= 0 ? table.selectedRow : 0
        let application = results[index]
        hide()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(
            at: URL(fileURLWithPath: application.path),
            configuration: configuration
        )
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
        cell.imageView?.image = NSWorkspace.shared.icon(forFile: application.path)
        return cell
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        installToggleSignal()
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
}

private let application = NSApplication.shared
private let delegate = LauncherDelegate()
application.delegate = delegate
application.run()
