import Foundation

enum EditorLaunch {
    static func neovimPath(fileManager: FileManager = .default) -> String {
        let candidates = [
            "/opt/homebrew/bin/nvim",
            "/usr/local/bin/nvim",
            "/usr/bin/nvim",
        ]
        return candidates.first(where: fileManager.isExecutableFile(atPath:)) ?? candidates[0]
    }

    static func command(for paths: [String], neovimPath: String) -> String {
        let arguments = paths.map(shellQuote).joined(separator: " ")
        let suffix = arguments.isEmpty ? "" : " -- \(arguments)"
        return "\(shellQuote(neovimPath))\(suffix)"
    }

    static func workingDirectory(for paths: [String], homeDirectory: String) -> String {
        guard let firstPath = paths.first else { return homeDirectory }
        return URL(fileURLWithPath: firstPath).deletingLastPathComponent().path
    }

    static func appleScript(for paths: [String], neovimPath: String, homeDirectory: String) -> String {
        let initialInput = appleScriptQuote(command(for: paths, neovimPath: neovimPath) + "; exit")
        let workingDirectory = appleScriptQuote(workingDirectory(for: paths, homeDirectory: homeDirectory))

        return """
        tell application "Ghostty"
            set surfaceConfig to new surface configuration
            set initial input of surfaceConfig to "\(initialInput)" & linefeed
            set initial working directory of surfaceConfig to "\(workingDirectory)"
            new window with configuration surfaceConfig
            activate
        end tell
        """
    }

    private static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private static func appleScriptQuote(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n")
    }
}
