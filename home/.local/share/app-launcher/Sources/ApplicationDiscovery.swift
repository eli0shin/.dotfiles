import Foundation

enum ApplicationDiscovery {
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

        // Finder is outside the scan roots. Safari can be a hidden cryptex link.
        let explicitApplications = [
            (name: "Finder", path: "/System/Library/CoreServices/Finder.app"),
            (name: "Safari", path: "/Applications/Safari.app"),
        ]
        for application in explicitApplications
        where FileManager.default.fileExists(atPath: application.path) {
            seenPaths.insert(application.path)
            applications.append(candidate(
                at: URL(fileURLWithPath: application.path), name: application.name
            ))
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
