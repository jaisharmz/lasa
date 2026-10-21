import AppKit
import Combine
import ServiceManagement

// The app's state: the account, the last sync, what macOS lets it read, and the runs of the sync engine.
// Everything here runs on the main thread.
@MainActor
final class Syncer: ObservableObject {
    enum Problem: Equatable {
        case denied, expired, offline
        case failed(String)
    }

    static let interval: TimeInterval = 600

    let place = Place.current
    @Published private(set) var account: Account?
    @Published private(set) var connecting = false
    @Published private(set) var connectError: String?
    @Published private(set) var syncing = false
    @Published private(set) var checking = false
    @Published private(set) var checked = false
    @Published private(set) var lastSync: Date?
    @Published private(set) var lastSummary: String?
    @Published private(set) var problem: Problem?
    @Published private(set) var sources: [SourceReport] = []
    @Published private(set) var tracked = 0
    @Published private(set) var cliAgent = false
    @Published private(set) var baselineRecorded: Int?
    @Published private(set) var visibility = "everyone"
    @Published private(set) var setupDone = false
    @Published private(set) var launchAtLogin = false

    private var connectRun: HelperRun?
    private var connectURL: URL?
    private var syncRun: HelperRun?
    private var statusRun: HelperRun?
    private var timer: Timer?
    private var wakeObserver: NSObjectProtocol?

    init() {
        account = Keychain.load(place.keychainAccount)
        lastSync = UserDefaults.standard.object(forKey: place.key("lastSync")) as? Date
        lastSummary = UserDefaults.standard.string(forKey: place.key("lastSummary"))
        setupDone = account != nil && UserDefaults.standard.bool(forKey: place.key("setupDone"))
        visibility = (readConfig()["visibility"] as? String) == "private" ? "private" : "everyone"
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    var needsSetup: Bool { !setupDone }
    var accessReady: Bool { checked && !sources.contains { $0.denied } }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: Self.interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sync(reason: "every 10 minutes") }
        }
        timer?.tolerance = 60
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            // Give the network a moment to come back after sleep.
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                self?.sync(reason: "wake")
            }
        }
        // Before setup, the first read waits for the Allow Access button, so the explanation comes before macOS asks.
        if setupDone {
            checkAccess()
            sync(reason: "launch")
        }
    }

    // MARK: Connecting

    func connect() {
        if connectRun != nil {
            openConnectLink()
            return
        }
        connectError = nil
        connecting = true
        do {
            connectRun = try HelperRun(["connect"], onEvent: { [weak self] event in
                self?.connectEvent(event)
            }, onExit: { [weak self] _ in
                self?.connectRun = nil
                self?.connectURL = nil
                self?.connecting = false
            })
        } catch {
            connecting = false
            connectError = "Couldn't start the sync engine: \(error.localizedDescription)"
        }
    }

    func cancelConnect() {
        connectRun?.cancel()
    }

    func openConnectLink() {
        guard let connectURL else { return }
        // LASA_NO_OPEN=1 leaves the link in the log instead, for testing in another browser.
        if ProcessInfo.processInfo.environment["LASA_NO_OPEN"] == "1" {
            Log.append("connect link: \(connectURL.absoluteString)")
        } else {
            NSWorkspace.shared.open(connectURL)
        }
    }

    private func connectEvent(_ event: HelperEvent) {
        switch event.event {
        case "url":
            connectURL = event.url.flatMap(URL.init(string:))
            openConnectLink()
        case "connected":
            guard let value = event.account else { return }
            do {
                try Keychain.save(value, as: place.keychainAccount)
                account = value
                if problem == .expired { problem = nil }
                Log.append("connected as @\(value.handle)")
            } catch {
                connectError = "Couldn't save the sign-in to the Keychain: \(error.localizedDescription)"
            }
        case "error":
            connectError = event.message
        default:
            break
        }
    }

    func disconnect() {
        syncRun?.cancel()
        Keychain.delete(place.keychainAccount)
        account = nil
        setupDone = false
        UserDefaults.standard.set(false, forKey: place.key("setupDone"))
        Log.append("disconnected")
    }

    // MARK: Access to Kindle and Apple Books

    // Reading the libraries is what makes macOS ask "Läsa would like to access data from other apps".
    func checkAccess() {
        guard statusRun == nil else { return }
        checking = true
        do {
            statusRun = try HelperRun(["status"], onEvent: { [weak self] event in
                guard let self, event.event == "status" else { return }
                self.sources = event.sources ?? []
                self.tracked = event.tracked ?? 0
                self.cliAgent = event.cliAgent ?? false
                self.checked = true
                if self.sources.contains(where: { $0.denied }) {
                    self.problem = .denied
                } else if self.problem == .denied {
                    self.problem = nil
                }
            }, onExit: { [weak self] _ in
                self?.statusRun = nil
                self?.checking = false
            })
        } catch {
            checking = false
            problem = .failed("Couldn't start the sync engine: \(error.localizedDescription)")
        }
    }

    // MARK: Syncing

    func sync(reason: String) {
        guard let account, syncRun == nil else { return }
        // Before setup finishes, only the baseline step syncs.
        guard setupDone || reason == "baseline" else { return }
        syncing = true
        Log.append("sync (\(reason))")
        do {
            let input = try JSONEncoder().encode(account)
            syncRun = try HelperRun(["sync"], input: input, onEvent: { [weak self] event in
                self?.syncEvent(event)
            }, onExit: { [weak self] _ in
                self?.syncRun = nil
                self?.syncing = false
            })
        } catch {
            syncing = false
            problem = .failed("Couldn't start the sync engine: \(error.localizedDescription)")
        }
    }

    private func syncEvent(_ event: HelperEvent) {
        switch event.event {
        case "log":
            if let line = event.line { Log.append(line) }
        case "done":
            let now = Date()
            lastSync = now
            sources = event.sources ?? sources
            tracked = event.tracked ?? tracked
            checked = true
            if let token = event.refreshToken, var updated = account {
                updated.refreshToken = token
                try? Keychain.save(updated, as: place.keychainAccount)
                account = updated
            }
            let written = event.written ?? 0
            let baseline = event.baseline ?? 0
            if baseline > 0 { baselineRecorded = baseline }
            if written > 0 {
                lastSummary = written == 1 ? "1 new session" : "\(written) new sessions"
            } else if baseline > 0 {
                lastSummary = "recorded where \(baseline) books stand"
            } else {
                lastSummary = "no new reading"
            }
            problem = sources.contains { $0.denied } ? .denied : nil
            UserDefaults.standard.set(now, forKey: place.key("lastSync"))
            UserDefaults.standard.set(lastSummary, forKey: place.key("lastSummary"))
        case "error":
            let message = event.message ?? "unknown error"
            Log.append("error: \(message)")
            if event.auth == true {
                problem = .expired
            } else if event.offline == true {
                problem = .offline
            } else {
                problem = .failed(message)
            }
        default:
            break
        }
    }

    func finishSetup() {
        setupDone = true
        UserDefaults.standard.set(true, forKey: place.key("setupDone"))
    }

    // MARK: Settings

    func setVisibility(_ value: String) {
        var config = readConfig()
        config["visibility"] = value
        try? FileManager.default.createDirectory(at: place.data, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: place.config, options: .atomic)
        }
        visibility = value
    }

    func setLaunchAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            Log.append("launch at login: \(error.localizedDescription)")
        }
        if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    private func readConfig() -> [String: Any] {
        guard let data = try? Data(contentsOf: place.config),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }
}
