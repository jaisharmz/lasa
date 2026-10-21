import Foundation

// Where this copy of the app syncs: the real site, or the Firebase emulators for development
// (LASA_EMULATORS=1, or `defaults write app.web.lasa-reading.mac emulators -bool true`).
struct Place {
    let emulators: Bool
    let site: URL
    let data: URL
    let keychainAccount: String

    static let current: Place = {
        let emulators = ProcessInfo.processInfo.environment["LASA_EMULATORS"] == "1" || UserDefaults.standard.bool(forKey: "emulators")
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Läsa", isDirectory: true)
        return Place(
            emulators: emulators,
            site: URL(string: emulators ? "http://127.0.0.1:7797" : "https://lasa-reading.web.app")!,
            data: emulators ? support.appendingPathComponent("emulators", isDirectory: true) : support,
            keychainAccount: emulators ? "emulators" : "lasa-reading")
    }()

    var helper: URL {
        Bundle.main.url(forAuxiliaryExecutable: "lasa-sync") ?? Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/lasa-sync")
    }
    var log: URL { data.appendingPathComponent("sync.log") }
    var config: URL { data.appendingPathComponent("config.json") }

    func key(_ name: String) -> String { emulators ? "emulators.\(name)" : name }
}

enum Log {
    private static let stamp = ISO8601DateFormatter()

    static func append(_ text: String, place: Place = .current) {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true)
        guard !lines.isEmpty else { return }
        let now = stamp.string(from: Date())
        let data = Data(lines.map { "\(now) \($0)\n" }.joined().utf8)
        try? FileManager.default.createDirectory(at: place.data, withIntermediateDirectories: true)
        let path = place.log.path
        if let size = (try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int, size > 1_000_000 {
            try? FileManager.default.removeItem(atPath: path + ".1")
            try? FileManager.default.moveItem(atPath: path, toPath: path + ".1")
        }
        if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
        guard let handle = FileHandle(forWritingAtPath: path) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }
}
