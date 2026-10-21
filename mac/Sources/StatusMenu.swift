import AppKit
import Combine

final class ActionItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, key: String = "", handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: key)
        target = self
    }

    required init(coder: NSCoder) { fatalError("not used") }

    @objc private func fire() { handler() }
}

// The menu-bar item. The menu is rebuilt each time it opens, so the times in it are always current.
@MainActor
final class StatusMenu: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let syncer: Syncer
    private let showSetup: () -> Void
    private var watcher: AnyCancellable?

    init(syncer: Syncer, showSetup: @escaping () -> Void) {
        self.syncer = syncer
        self.showSetup = showSetup
        super.init()
        item.button?.toolTip = "Läsa"
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        updateIcon()
        watcher = syncer.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.updateIcon() }
        }
    }

    private func updateIcon() {
        let attention = syncer.account == nil || (syncer.problem != nil && syncer.problem != .offline)
        item.button?.image = Glyph.menuBar(dimmed: syncer.syncing || syncer.connecting, badge: attention)
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        for entry in entries() { menu.addItem(entry) }
    }

    private func note(_ title: String) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        entry.isEnabled = false
        return entry
    }

    private func entries() -> [NSMenuItem] {
        var list: [NSMenuItem] = []
        guard let account = syncer.account else {
            list.append(note("Läsa isn't connected"))
            list.append(ActionItem("Set Up Läsa…") { [weak self] in self?.showSetup() })
            list.append(.separator())
            list.append(ActionItem("Quit Läsa", key: "q") { NSApp.terminate(nil) })
            return list
        }

        list.append(note("@\(account.handle)" + (syncer.place.emulators ? " (emulators)" : "")))
        list.append(note(statusLine()))
        for source in syncer.sources { list.append(note("    " + describe(source))) }

        switch syncer.problem {
        case .denied:
            list.append(ActionItem("Fix Access to Kindle and Apple Books…") { [weak self] in self?.showSetup() })
        case .expired:
            list.append(ActionItem("Reconnect…") { [weak self] in
                self?.syncer.connect()
                self?.showSetup()
            })
        default:
            break
        }
        if !syncer.setupDone {
            list.append(ActionItem("Finish Setting Up…") { [weak self] in self?.showSetup() })
        }
        if syncer.cliAgent {
            list.append(note("The command-line sync is also installed; remove it with `lasa agent uninstall`"))
        }

        list.append(.separator())
        let syncNow = ActionItem(syncer.syncing ? "Syncing…" : "Sync Now", key: "s") { [weak self] in self?.syncer.sync(reason: "Sync Now") }
        syncNow.isEnabled = !syncer.syncing && syncer.setupDone
        list.append(syncNow)
        list.append(ActionItem("Open Läsa") { [weak self] in
            guard let self else { return }
            NSWorkspace.shared.open(self.syncer.place.site)
        })

        list.append(.separator())
        let visibility = NSMenuItem(title: "New Sessions Are Visible To", action: nil, keyEquivalent: "")
        let choices = NSMenu()
        for (value, title) in [("everyone", "Everyone"), ("private", "Only Me")] {
            let choice = ActionItem(title) { [weak self] in self?.syncer.setVisibility(value) }
            choice.state = syncer.visibility == value ? .on : .off
            choices.addItem(choice)
        }
        visibility.submenu = choices
        list.append(visibility)
        let login = ActionItem("Open at Login") { [weak self] in
            guard let self else { return }
            self.syncer.setLaunchAtLogin(!self.syncer.launchAtLogin)
        }
        login.state = syncer.launchAtLogin ? .on : .off
        list.append(login)
        list.append(ActionItem("Show Sync Log") { [weak self] in
            guard let self else { return }
            let log = self.syncer.place.log
            if FileManager.default.fileExists(atPath: log.path) { NSWorkspace.shared.open(log) }
        })

        list.append(.separator())
        list.append(ActionItem("Disconnect @\(account.handle)…") { [weak self] in self?.confirmDisconnect(account) })
        list.append(ActionItem("Quit Läsa", key: "q") { NSApp.terminate(nil) })
        return list
    }

    private func statusLine() -> String {
        if syncer.syncing { return "Syncing…" }
        switch syncer.problem {
        case .denied: return "macOS is blocking access to your books"
        case .expired: return "Sign-in expired"
        case .offline: return "Offline; will try again in 10 minutes"
        case .failed(let message): return "Sync failed: \(message.prefix(60))"
        case nil: break
        }
        guard let last = syncer.lastSync else { return "Not synced yet" }
        let when = Date().timeIntervalSince(last) < 60 ? "just now" : RelativeDateTimeFormatter().localizedString(for: last, relativeTo: Date())
        return "Synced \(when)" + (syncer.lastSummary.map { ", \($0)" } ?? "")
    }

    private func describe(_ source: SourceReport) -> String {
        if source.denied { return "\(source.name): blocked by macOS" }
        if !source.available { return "\(source.name): not found on this Mac" }
        return "\(source.name): \(source.books) \(source.books == 1 ? "book" : "books")"
    }

    private func confirmDisconnect(_ account: Account) {
        let alert = NSAlert()
        alert.messageText = "Disconnect @\(account.handle)?"
        alert.informativeText = "This Mac stops syncing and forgets the sign-in. Sessions already on Läsa stay there."
        alert.addButton(withTitle: "Disconnect")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { syncer.disconnect() }
    }
}
