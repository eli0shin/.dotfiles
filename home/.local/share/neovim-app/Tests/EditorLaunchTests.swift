import Foundation

@main
struct EditorLaunchTests {
    static func main() {
        testEmptyLaunch()
        testFileArgumentsAreQuoted()
        testWorkingDirectory()
        testAppleScriptEscaping()
        print("Neovim app tests passed")
    }

    private static func testEmptyLaunch() {
        let command = EditorLaunch.command(for: [], neovimPath: "/opt/homebrew/bin/nvim")
        expect(command == "'/opt/homebrew/bin/nvim'", "empty launch must open Neovim")
    }

    private static func testFileArgumentsAreQuoted() {
        let command = EditorLaunch.command(
            for: ["/tmp/one file.txt", "/tmp/user's file.swift"],
            neovimPath: "/opt/homebrew/bin/nvim"
        )
        expect(
            command == "'/opt/homebrew/bin/nvim' -- '/tmp/one file.txt' '/tmp/user'\\''s file.swift'",
            "file paths must be safe shell arguments"
        )
    }

    private static func testWorkingDirectory() {
        expect(
            EditorLaunch.workingDirectory(for: ["/tmp/project/main.swift"], homeDirectory: "/Users/example") == "/tmp/project",
            "working directory must be the first file's parent"
        )
        expect(
            EditorLaunch.workingDirectory(for: [], homeDirectory: "/Users/example") == "/Users/example",
            "empty launch must use the home directory"
        )
    }

    private static func testAppleScriptEscaping() {
        let script = EditorLaunch.appleScript(
            for: ["/tmp/a \"quoted\" file.swift"],
            neovimPath: "/opt/homebrew/bin/nvim",
            homeDirectory: "/Users/example"
        )
        expect(script.contains("\\\"quoted\\\""), "AppleScript strings must escape quotes")
        expect(script.contains("set initial input of surfaceConfig"), "adapter must run Neovim through Ghostty's normal shell")
        expect(script.contains("; exit\" & linefeed"), "shell must exit after Neovim closes")
        expect(!script.contains("set command of surfaceConfig"), "one-shot command surfaces wait for a keypress after exit")
        expect(script.contains("new window with configuration surfaceConfig"), "adapter must use Ghostty's new-window API")
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else {
            FileHandle.standardError.write("FAIL: \(message)\n".data(using: .utf8)!)
            exit(1)
        }
    }
}
