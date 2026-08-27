import Foundation

@main
struct MatcherTests {
    static let apps = [
        LaunchCandidate(name: "ChatGPT", path: "/Applications/ChatGPT.app"),
        LaunchCandidate(name: "Google Chrome", path: "/Applications/Google Chrome.app"),
        LaunchCandidate(name: "Ghostty", path: "/Applications/Ghostty.app"),
        LaunchCandidate(name: "Visual Studio Code", path: "/Applications/Visual Studio Code.app"),
    ]

    static func main() {
        testExactAliasResolvesConflict()
        testAlternateNameIsSearchable()
        testWordBoundaries()
        testConsecutiveCharacters()
        testLeadingMatchBeatsShortTrailingMatch()
        testFuzzySubsequence()
        testExcludedApplication()
        testLeadingWildcardExclusion()
        testTrailingWildcardExclusion()
        testSurroundingWildcardExclusion()
        testStableEmptyQuery()
        testLaunchPolicy()
        print("Matcher and launch policy tests passed")
    }

    private static func testExactAliasResolvesConflict() {
        let results = ApplicationMatcher.rank(
            query: "ch",
            candidates: apps,
            aliases: ["Google Chrome": ["chrome", "browser", "ch"]]
        )
        expect(results.first?.candidate.name == "Google Chrome", "exact alias must resolve conflicts")
    }

    private static func testAlternateNameIsSearchable() {
        let results = ApplicationMatcher.rank(
            query: "brwsr",
            candidates: apps,
            aliases: ["Google Chrome": ["browser"]]
        )
        expect(results.first?.candidate.name == "Google Chrome", "aliases must participate in fuzzy matching")
    }

    private static func testWordBoundaries() {
        let results = ApplicationMatcher.rank(query: "vsc", candidates: apps)
        expect(results.first?.candidate.name == "Visual Studio Code", "word boundaries must receive a match bonus")
    }

    private static func testConsecutiveCharacters() {
        let candidates = [
            LaunchCandidate(name: "C Home", path: "/Applications/C Home.app"),
            LaunchCandidate(name: "Chrome", path: "/Applications/Chrome.app"),
        ]
        let results = ApplicationMatcher.rank(query: "ch", candidates: candidates)
        expect(results.first?.candidate.name == "Chrome", "consecutive characters must beat separated characters")
    }

    private static func testLeadingMatchBeatsShortTrailingMatch() {
        let candidates = [
            LaunchCandidate(name: "Activity Monitor", path: "/Applications/Activity Monitor.app"),
            LaunchCandidate(name: "Slack", path: "/Applications/Slack.app"),
        ]
        let results = ApplicationMatcher.rank(query: "ac", candidates: candidates)
        expect(results.first?.candidate.name == "Activity Monitor", "a leading consecutive match must beat a trailing match in a shorter name")
    }

    private static func testFuzzySubsequence() {
        let results = ApplicationMatcher.rank(query: "gty", candidates: apps)
        expect(results.first?.candidate.name == "Ghostty", "ordered fuzzy characters must match")
    }

    private static func testExcludedApplication() {
        let results = ApplicationMatcher.rank(
            query: "chat",
            candidates: apps,
            excluding: ["ChatGPT"]
        )
        expect(!results.contains(where: { $0.candidate.name == "ChatGPT" }), "excluded apps must never appear")
    }

    private static func testLeadingWildcardExclusion() {
        let candidates = apps + [
            LaunchCandidate(name: "Adobe Creative Cloud Diagnostics", path: "/Applications/Adobe Diagnostics.app"),
        ]
        let results = ApplicationMatcher.rank(query: "", candidates: candidates, excluding: ["Adobe*"])
        expect(!results.contains(where: { $0.candidate.name.hasPrefix("Adobe") }), "trailing wildcard must exclude name prefixes")
    }

    private static func testTrailingWildcardExclusion() {
        let candidates = apps + [
            LaunchCandidate(name: "Adobe Creative Cloud Diagnostics", path: "/Applications/Adobe Diagnostics.app"),
        ]
        let results = ApplicationMatcher.rank(query: "", candidates: candidates, excluding: ["*Diagnostics"])
        expect(!results.contains(where: { $0.candidate.name.hasSuffix("Diagnostics") }), "leading wildcard must exclude name suffixes")
    }

    private static func testSurroundingWildcardExclusion() {
        let candidates = apps + [
            LaunchCandidate(name: "Adobe Creative Cloud Diagnostics", path: "/Applications/Adobe Diagnostics.app"),
        ]
        let results = ApplicationMatcher.rank(query: "", candidates: candidates, excluding: ["*creative cloud*"])
        expect(!results.contains(where: { $0.candidate.name.contains("Creative Cloud") }), "surrounding wildcards must exclude contained text")
    }

    private static func testStableEmptyQuery() {
        let results = ApplicationMatcher.rank(query: "", candidates: apps)
        expect(results.map(\.candidate.name) == ["ChatGPT", "Ghostty", "Google Chrome", "Visual Studio Code"], "empty query must use stable name order")
    }

    private static func testLaunchPolicy() {
        expect(
            ApplicationLaunchPolicy.action(intent: .open, isRunning: false, existingWindowCount: 0)
                == .openWindowInCurrentWorkspace,
            "a closed app must open in the current workspace"
        )
        expect(
            ApplicationLaunchPolicy.action(intent: .open, isRunning: true, existingWindowCount: 2)
                == .focusExistingWindow,
            "an open app must focus an existing window"
        )
        expect(
            ApplicationLaunchPolicy.action(intent: .open, isRunning: true, existingWindowCount: 0)
                == .openWindowInCurrentWorkspace,
            "a windowless running app must open in the current workspace"
        )
        expect(
            ApplicationLaunchPolicy.action(intent: .newWindow, isRunning: true, existingWindowCount: 1)
                == .createWindowInCurrentWorkspace,
            "the explicit new-window action must create a window in the current workspace"
        )
        expect(
            ApplicationLaunchPolicy.action(intent: .newWindow, isRunning: true, existingWindowCount: 0)
                == .openWindowInCurrentWorkspace,
            "the new-window action must not create two windows for a windowless app"
        )
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else {
            FileHandle.standardError.write("FAIL: \(message)\n".data(using: .utf8)!)
            exit(1)
        }
    }
}
