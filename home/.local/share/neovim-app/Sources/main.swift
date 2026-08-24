import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var openedFiles = false
    private var launchedEditor = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self, !self.openedFiles else { return }
            self.openEditor(with: [])
        }
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        openedFiles = true
        openEditor(with: filenames)
        sender.reply(toOpenOrPrint: .success)
    }

    private func openEditor(with paths: [String]) {
        guard !launchedEditor else { return }
        launchedEditor = true

        NSApp.activate(ignoringOtherApps: true)

        let scriptSource = EditorLaunch.appleScript(
            for: paths,
            neovimPath: EditorLaunch.neovimPath(),
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser.path
        )
        var error: NSDictionary?
        NSAppleScript(source: scriptSource)?.executeAndReturnError(&error)
        if let error {
            NSLog("Could not open Neovim in Ghostty: %@", error)
        }
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
