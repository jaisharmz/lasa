import AppKit
import SwiftUI

@main
enum Main {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let syncer = Syncer()
    private var menu: StatusMenu?
    private var setupWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A helper that exits before reading stdin must not take the app down with it.
        signal(SIGPIPE, SIG_IGN)
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .filter { $0 != NSRunningApplication.current }
        if !others.isEmpty {
            NSApp.terminate(nil)
            return
        }
        menu = StatusMenu(syncer: syncer, showSetup: { [weak self] in self?.showSetup() })
        syncer.start()
        // At launch the window opens without taking focus: opened from Finder the app is already in front,
        // and opened at login it shouldn't grab the keys someone is typing elsewhere.
        if syncer.needsSetup { showSetup(activate: false) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showSetup()
        return true
    }

    private func showSetup(activate: Bool = true) {
        if setupWindow == nil {
            let window = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = syncer.place.emulators ? "Läsa (emulators)" : "Läsa"
            window.isReleasedWhenClosed = false
            let content = NSHostingController(rootView: SetupView(syncer: syncer, close: { [weak window] in window?.close() }))
            window.contentViewController = content
            window.setContentSize(content.view.fittingSize)
            window.center()
            setupWindow = window
        }
        if activate { NSApp.activate(ignoringOtherApps: true) }
        setupWindow?.makeKeyAndOrderFront(nil)
    }
}
