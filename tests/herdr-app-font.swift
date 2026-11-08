// macOS integration check. First run: uv run scripts/prepare-herdr-fonts.py
// Then, from the repo root: swift tests/herdr-app-font.swift
import Foundation
import CoreText

func fail(_ message: String) -> Never {
    fputs("FAIL: \(message)\n", stderr)
    exit(1)
}

let family = "Operator Mono Book Herdr"
let config = URL(fileURLWithPath: "home/.config/herdr-app")
let data = try Data(contentsOf: config.appendingPathComponent("settings.json"))
let settings = try JSONSerialization.jsonObject(with: data) as! [String: Any]
for key in ["font", "ui_font"] {
    guard settings[key] as? String == family else { fail("\(key) must select the isolated Book family") }
}
// Herdr loads these files into its own process, not the system font database.
for suffix in ["Regular", "Italic", "Bold", "BoldItalic"] {
    let url = config.appendingPathComponent("fonts/DotfilesOperatorMonoBook-\(suffix).otf")
    var error: Unmanaged<CFError>?
    guard CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) else {
        fail("Cannot register \(url.path): \(String(describing: error?.takeRetainedValue()))")
    }
}
let families = CTFontManagerCopyAvailableFontFamilyNames() as! [String]
guard families.contains(family) else { fail("App-local Book family is unavailable") }

// Herdr requests Medium (500) for normal cells and Bold (700) for bold ones.
// Font-kit's CoreText mapping uses 0.2 and 0.4 respectively. Verify selection,
// not merely that a face exists somewhere on the machine.
for (suffix, weight, italic) in [("Regular", 0.2, false), ("Italic", 0.2, true),
                                ("Bold", 0.4, false), ("BoldItalic", 0.4, true)] {
    let traits: [CFString: Any] = [
        kCTFontWeightTrait: weight,
        kCTFontSymbolicTrait: italic ? CTFontSymbolicTraits.traitItalic.rawValue : 0,
    ]
    let attributes: [CFString: Any] = [kCTFontFamilyNameAttribute: family, kCTFontTraitsAttribute: traits]
    let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
    let font = CTFontCreateWithFontDescriptor(descriptor, 16, nil)
    let expected = "DotfilesOperatorMonoBook-\(suffix)"
    guard CTFontCopyPostScriptName(font) as String == expected else {
        fail("Requested \(suffix), resolved \(CTFontCopyPostScriptName(font)) instead of \(expected)")
    }
    let resolvedTraits = CTFontCopyTraits(font) as NSDictionary
    let resolvedWeight = resolvedTraits[kCTFontWeightTrait] as! Double
    guard abs(resolvedWeight - weight) < 0.001 else { fail("Wrong native weight for \(suffix)") }
    print("PASS: native selection resolves \(suffix) to \(expected)")
}
