import Foundation

struct LaunchCandidate: Equatable {
    let name: String
    let path: String
    let iconVersion: String

    init(name: String, path: String, iconVersion: String = "") {
        self.name = name
        self.path = path
        self.iconVersion = iconVersion
    }
}

struct RankedCandidate: Equatable {
    let candidate: LaunchCandidate
    let score: Int
}

enum ApplicationMatcher {
    static func rank(
        query: String,
        candidates: [LaunchCandidate],
        aliases: [String: [String]] = [:],
        excluding excludedNames: [String] = []
    ) -> [RankedCandidate] {
        let normalizedQuery = searchable(query)
        let visibleCandidates = candidates.filter { candidate in
            !excludedNames.contains { exclusionMatches(name: candidate.name, pattern: $0) }
        }

        guard !normalizedQuery.isEmpty else {
            return visibleCandidates
                .sorted(by: stableOrder)
                .map { RankedCandidate(candidate: $0, score: 0) }
        }

        return visibleCandidates.compactMap { candidate in
            let configuredAliases = aliases.first {
                searchable($0.key) == searchable(candidate.name)
            }?.value ?? []

            var bestScore = fuzzyScore(query: normalizedQuery, target: candidate.name)
            for alias in configuredAliases {
                guard var score = fuzzyScore(query: normalizedQuery, target: alias) else { continue }
                if searchable(alias) == normalizedQuery {
                    score += 100_000
                }
                bestScore = max(bestScore ?? Int.min, score)
            }

            guard let bestScore else { return nil }
            return RankedCandidate(candidate: candidate, score: bestScore)
        }
        .sorted {
            if $0.score != $1.score { return $0.score > $1.score }
            return stableOrder($0.candidate, $1.candidate)
        }
    }

    private static func fuzzyScore(query: String, target: String) -> Int? {
        let queryCharacters = Array(searchable(query))
        let targetCharacters = Array(searchable(target))
        let originalCharacters = Array(target.folding(
            options: [.diacriticInsensitive],
            locale: .current
        ))

        guard !queryCharacters.isEmpty, queryCharacters.count <= targetCharacters.count else {
            return nil
        }

        var previous = Array<Int?>(repeating: nil, count: targetCharacters.count)
        for targetIndex in targetCharacters.indices where targetCharacters[targetIndex] == queryCharacters[0] {
            previous[targetIndex] = 16
                + boundaryBonus(at: targetIndex, in: originalCharacters)
                - gapPenalty(targetIndex)
        }

        for queryIndex in queryCharacters.indices.dropFirst() {
            var current = Array<Int?>(repeating: nil, count: targetCharacters.count)
            for targetIndex in targetCharacters.indices where targetCharacters[targetIndex] == queryCharacters[queryIndex] {
                var best: Int?
                for previousIndex in 0..<targetIndex {
                    guard let previousScore = previous[previousIndex] else { continue }
                    let gap = targetIndex - previousIndex - 1
                    let transition = gap == 0 ? 8 : -gapPenalty(gap)
                    let score = previousScore
                        + 16
                        + transition
                        + boundaryBonus(at: targetIndex, in: originalCharacters)
                    best = max(best ?? Int.min, score)
                }
                current[targetIndex] = best
            }
            previous = current
        }

        return previous.compactMap { $0 }.max()
    }

    private static func boundaryBonus(at index: Int, in characters: [Character]) -> Int {
        guard index > 0, index < characters.count else { return index == 0 ? 8 : 0 }
        let previous = characters[index - 1]
        let current = characters[index]

        if !previous.isLetter && !previous.isNumber { return 8 }
        if previous.isLowercase && current.isUppercase { return 7 }
        if previous.isLetter != current.isLetter { return 5 }
        if previous.isNumber != current.isNumber { return 5 }
        return 0
    }

    private static func gapPenalty(_ length: Int) -> Int {
        guard length > 0 else { return 0 }
        return 3 + length - 1
    }

    private static func exclusionMatches(name: String, pattern: String) -> Bool {
        let normalizedName = searchable(name)
        let normalizedPattern = searchable(pattern)
        let hasLeadingWildcard = normalizedPattern.hasPrefix("*")
        let hasTrailingWildcard = normalizedPattern.hasSuffix("*")

        var value = normalizedPattern
        if hasLeadingWildcard { value.removeFirst() }
        if hasTrailingWildcard, !value.isEmpty { value.removeLast() }

        switch (hasLeadingWildcard, hasTrailingWildcard) {
        case (true, true):
            return normalizedName.contains(value)
        case (true, false):
            return normalizedName.hasSuffix(value)
        case (false, true):
            return normalizedName.hasPrefix(value)
        case (false, false):
            return normalizedName == value
        }
    }

    private static func stableOrder(_ lhs: LaunchCandidate, _ rhs: LaunchCandidate) -> Bool {
        let comparison = lhs.name.localizedCaseInsensitiveCompare(rhs.name)
        if comparison != .orderedSame { return comparison == .orderedAscending }
        return lhs.path < rhs.path
    }

    private static func searchable(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased()
    }
}
