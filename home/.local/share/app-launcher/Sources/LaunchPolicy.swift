import Foundation

enum LaunchIntent: Equatable {
    case open
    case newWindow
}

enum ApplicationLaunchAction: Equatable {
    case focusExistingWindow
    case openWindowInCurrentWorkspace
    case createWindowInCurrentWorkspace
}

enum ApplicationLaunchPolicy {
    static func action(
        intent: LaunchIntent,
        isRunning: Bool,
        existingWindowCount: Int
    ) -> ApplicationLaunchAction {
        if existingWindowCount == 0 {
            return .openWindowInCurrentWorkspace
        }
        if intent == .newWindow {
            return .createWindowInCurrentWorkspace
        }
        if isRunning {
            return .focusExistingWindow
        }
        return .openWindowInCurrentWorkspace
    }
}
