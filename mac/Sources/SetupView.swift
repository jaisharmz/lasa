import AppKit
import SwiftUI

private let fullDiskAccess = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!

// The first-run window: connect, let macOS allow access, record the baseline. Each step opens when the one
// before it is done, and the window doubles as a status page afterwards.
struct SetupView: View {
    @ObservedObject var syncer: Syncer
    let close: () -> Void

    private var connected: Bool { syncer.account != nil }
    private var recorded: Bool { syncer.baselineRecorded != nil || syncer.tracked > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 56, height: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Läsa for Mac").font(.title2.weight(.semibold))
                    Text("Turns your Kindle and Apple Books reading into sessions on Läsa.").foregroundStyle(.secondary)
                }
            }

            Step(number: 1, title: "Connect your Läsa account", done: connected, open: true) {
                if let account = syncer.account {
                    Text("Connected as @\(account.handle)" + (account.email.map { " (\($0))" } ?? "") + ".")
                } else if syncer.connecting {
                    Text("Your browser opened Läsa. Sign in there and press Connect.")
                    HStack {
                        ProgressView().controlSize(.small)
                        Button("Open the Link Again") { syncer.openConnectLink() }.accessibilityIdentifier("open-link")
                        Button("Cancel") { syncer.cancelConnect() }.accessibilityIdentifier("cancel-connect")
                    }
                } else {
                    Text("Läsa opens in your browser, where you sign in with Google and press Connect. The sign-in is kept in your Mac's Keychain.")
                    Button("Connect in Browser") { syncer.connect() }.keyboardShortcut(.defaultAction).accessibilityIdentifier("connect")
                }
                if let error = syncer.connectError { Text(error).foregroundStyle(.red) }
            }

            Step(number: 2, title: "Let Läsa read Kindle and Apple Books", done: connected && syncer.accessReady, open: connected) {
                if !syncer.accessReady {
                    Text("Both apps keep reading progress in folders that macOS guards. When you press Allow Access, macOS asks whether Läsa may access data from other apps. Choose Allow. Läsa copies the progress databases and never changes them.")
                        .fixedSize(horizontal: false, vertical: true)
                }
                if syncer.checked {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(syncer.sources, id: \.source) { source in SourceLine(source: source) }
                    }
                }
                if syncer.sources.contains(where: { $0.denied }) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("macOS is blocking Läsa. To fix it:").fontWeight(.medium)
                        Group {
                            Text("1. Open System Settings, then Privacy & Security, then Full Disk Access.")
                            Text("2. Switch on Läsa. If it isn't in the list, press +, and choose Läsa in Applications.")
                            Text("3. If macOS offers to quit and reopen Läsa, accept. Then press Check Again.")
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button("Open Full Disk Access") { NSWorkspace.shared.open(fullDiskAccess) }.accessibilityIdentifier("open-full-disk-access")
                            Button("Check Again") { syncer.checkAccess() }.disabled(syncer.checking).accessibilityIdentifier("check-again")
                        }
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.12)))
                } else if syncer.checked && !syncer.sources.contains(where: { $0.available }) {
                    Text("Neither app has books on this Mac yet. Open a book in Kindle for Mac or Apple Books, then press Check Again.")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Check Again") { syncer.checkAccess() }.disabled(syncer.checking).accessibilityIdentifier("check-again")
                } else if !syncer.checked || !syncer.accessReady {
                    HStack {
                        Button("Allow Access") { syncer.checkAccess() }.disabled(syncer.checking).accessibilityIdentifier("allow-access")
                        if syncer.checking { ProgressView().controlSize(.small) }
                    }
                }
            }

            Step(number: 3, title: "Record where your books stand", done: recorded, open: connected && syncer.accessReady) {
                if let count = syncer.baselineRecorded {
                    Text("Recorded \(count) \(count == 1 ? "book" : "books"). Reading from now on becomes sessions, and Läsa syncs every 10 minutes and when your Mac wakes.")
                        .fixedSize(horizontal: false, vertical: true)
                } else if syncer.tracked > 0 {
                    Text("Läsa already knows where \(syncer.tracked) books stand. Reading from now on becomes sessions.")
                } else {
                    Text("The first sync notes how far you are in every book, so books you already read don't flood your feed. Reading after this becomes sessions.")
                        .fixedSize(horizontal: false, vertical: true)
                    Picker("New sessions are visible to", selection: Binding(get: { syncer.visibility }, set: { syncer.setVisibility($0) })) {
                        Text("Everyone").tag("everyone")
                        Text("Only me").tag("private")
                    }
                    .pickerStyle(.radioGroup)
                    .accessibilityIdentifier("visibility")
                    HStack {
                        Button("Record Where My Books Stand") { syncer.sync(reason: "baseline") }.disabled(syncer.syncing).accessibilityIdentifier("record")
                        if syncer.syncing { ProgressView().controlSize(.small) }
                    }
                }
                if case .failed(let message) = syncer.problem { Text(message).foregroundStyle(.red) }
                if syncer.problem == .offline { Text("Läsa couldn't reach the internet. Try again when you're online.").foregroundStyle(.red) }
            }

            Divider()
            HStack {
                Toggle("Open Läsa at login", isOn: Binding(get: { syncer.launchAtLogin }, set: { syncer.setLaunchAtLogin($0) })).accessibilityIdentifier("launch-at-login")
                Spacer()
                Button(syncer.setupDone ? "Close" : (connected && recorded ? "Done" : "Later")) {
                    if connected && recorded { syncer.finishSetup() }
                    close()
                }
                .accessibilityIdentifier("done")
            }
        }
        .padding(24)
        .frame(width: 520)
    }
}

private struct Step<Content: View>: View {
    let number: Int
    let title: String
    let done: Bool
    let open: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(done ? Color.green : (open ? Color.accentColor : Color.secondary.opacity(0.4)))
                if done {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                } else {
                    Text("\(number)").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                }
            }
            .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.headline).foregroundStyle(open || done ? .primary : .secondary)
                if open { content() }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct SourceLine: View {
    let source: SourceReport

    var body: some View {
        HStack(spacing: 6) {
            if source.denied {
                Image(systemName: "xmark.circle.fill").foregroundColor(.red)
                Text("\(source.name): blocked by macOS")
            } else if source.available {
                Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
                Text("\(source.name): \(source.books) \(source.books == 1 ? "book" : "books")")
            } else {
                Image(systemName: "minus.circle").foregroundColor(.secondary)
                Text("\(source.name): not found on this Mac").foregroundStyle(.secondary)
            }
        }
    }
}
