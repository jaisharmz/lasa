import Foundation

struct SourceReport: Codable, Equatable {
    let source: String
    let available: Bool
    let denied: Bool
    let books: Int
    let started: Int?
    let error: String?

    var name: String {
        switch source {
        case "kindle": return "Kindle"
        case "apple-books": return "Apple Books"
        default: return source
        }
    }
}

struct SessionReport: Codable, Equatable {
    let name: String
    let book: String
    let minutes: Int
    let pages: Int
}

// One line of the sync engine's output (mac/helper.mjs). Which fields are set depends on `event`.
struct HelperEvent: Decodable {
    let event: String
    var url: String?
    var line: String?
    var message: String?
    var auth: Bool?
    var offline: Bool?
    var account: Account?
    var sources: [SourceReport]?
    var written: Int?
    var baseline: Int?
    var sessions: [SessionReport]?
    var tracked: Int?
    var syncedAt: String?
    var refreshToken: String?
    var cliAgent: Bool?
}

// Runs the bundled sync engine once. Events and the exit status arrive on the main queue, in order.
final class HelperRun {
    private let process = Process()
    private var buffer = Data()
    private let onEvent: (HelperEvent) -> Void

    init(_ arguments: [String], input: Data? = nil, place: Place = .current,
         onEvent: @escaping (HelperEvent) -> Void, onExit: @escaping (Int32) -> Void) throws {
        self.onEvent = onEvent
        process.executableURL = place.helper
        process.arguments = arguments + ["--data", place.data.path] + (place.emulators ? ["--emulators"] : [])
        let output = Pipe(), errors = Pipe(), stdin = Pipe()
        process.standardOutput = output
        process.standardError = errors
        process.standardInput = stdin

        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global(qos: .utility).async { [self] in
            while case let chunk = output.fileHandleForReading.availableData, !chunk.isEmpty {
                DispatchQueue.main.async { self.consume(chunk) }
            }
            group.leave()
        }
        DispatchQueue.global(qos: .utility).async {
            while case let chunk = errors.fileHandleForReading.availableData, !chunk.isEmpty {
                let text = String(decoding: chunk, as: UTF8.self)
                DispatchQueue.main.async { Log.append(text, place: place) }
            }
        }
        group.enter()
        process.terminationHandler = { _ in group.leave() }
        group.notify(queue: .main) { [self] in
            consume(Data([0x0A]))
            onExit(process.terminationStatus)
        }

        try process.run()
        if let input { try? stdin.fileHandleForWriting.write(contentsOf: input) }
        try? stdin.fileHandleForWriting.close()
    }

    func cancel() {
        if process.isRunning { process.terminate() }
    }

    private func consume(_ chunk: Data) {
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<newline]
            buffer.removeSubrange(buffer.startIndex...newline)
            guard !line.isEmpty else { continue }
            if let event = try? JSONDecoder().decode(HelperEvent.self, from: Data(line)) {
                onEvent(event)
            } else {
                Log.append(String(decoding: line, as: UTF8.self))
            }
        }
    }
}
