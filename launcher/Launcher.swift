import AppKit

final class StudioLauncher: NSObject, NSApplicationDelegate {
    var window: NSWindow?
    var statusItem: NSStatusItem?
    var monitor: Process?
    var log: FileHandle?
    var opening = false
    var quitting = false
    var node = ""
    let root = Bundle.main.bundleURL.deletingLastPathComponent()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser.path
        let candidates = [home + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        guard let executable = candidates.first(where: { fm.isExecutableFile(atPath: $0) }) else {
            showError("Node.js could not be found. Install Node.js 22 or newer, then open the studio again.")
            NSApp.terminate(nil); return
        }
        node = executable
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "FS2"
        item.button?.font = .systemFont(ofSize: 13, weight: .semibold)
        item.button?.toolTip = "FWRD.STUDIO.V2 — server running in the background"
        let menu = NSMenu()
        let open = NSMenuItem(title: "Open FWRD.STUDIO.V2", action: #selector(openStudio), keyEquivalent: "")
        open.target = self; menu.addItem(open); menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit FWRD.STUDIO.V2", action: #selector(quitStudio), keyEquivalent: "q")
        quit.target = self; menu.addItem(quit); item.menu = menu; statusItem = item
        startMonitor()
        openStudio()
    }

    func startMonitor() {
        if quitting || monitor?.isRunning == true { return }
        do {
            let folder = root.appendingPathComponent(".local", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let path = folder.appendingPathComponent("service.log")
            if !FileManager.default.fileExists(atPath: path.path) {
                FileManager.default.createFile(atPath: path.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            // Keep diagnostic output bounded across launches; no prompts or keys are logged.
            if let size = (try FileManager.default.attributesOfItem(atPath: path.path)[.size]) as? NSNumber, size.intValue > 5 * 1024 * 1024 {
                let previous = folder.appendingPathComponent("service.previous.log")
                try? FileManager.default.removeItem(at: previous)
                try FileManager.default.moveItem(at: path, to: previous)
                FileManager.default.createFile(atPath: path.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            log = try FileHandle(forWritingTo: path); log?.seekToEndOfFile()
            let process = Process()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [root.appendingPathComponent("service.mjs").path]
            process.currentDirectoryURL = root
            process.environment = ProcessInfo.processInfo.environment.merging(["PORT": "4322", "FRAME_OPEN_BROWSER": "0"]) { _, new in new }
            process.standardOutput = log; process.standardError = log
            process.terminationHandler = { [weak self] _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                    guard let self = self, !self.quitting else { return }
                    self.startMonitor()
                }
            }
            try process.run(); monitor = process
        } catch { showError(error.localizedDescription) }
    }

    @objc func openStudio() {
        if opening { return }; opening = true
        startMonitor()
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 380, height: 155), styleMask: [.titled], backing: .buffered, defer: false)
        panel.title = "FWRD.STUDIO.V2"; panel.appearance = NSAppearance(named: .darkAqua)
        panel.backgroundColor = NSColor(calibratedRed: 0.055, green: 0.078, blue: 0.105, alpha: 1); panel.center()
        let label = NSTextField(labelWithString: "Opening your studio…")
        label.font = .systemFont(ofSize: 19, weight: .medium)
        label.textColor = NSColor(calibratedRed: 0.82, green: 0.88, blue: 0.94, alpha: 1)
        label.frame = NSRect(x: 40, y: 0, width: 300, height: 28)
        label.setFrameOrigin(NSPoint(x: 40, y: 89))
        let detail = NSTextField(labelWithString: "You can close the browser when you're done.")
        detail.textColor = .secondaryLabelColor; detail.frame = NSRect(x: 40, y: 59, width: 310, height: 22)
        let progress = NSProgressIndicator(frame: NSRect(x: 40, y: 32, width: 300, height: 12))
        progress.style = .bar; progress.isIndeterminate = true; progress.startAnimation(nil)
        panel.contentView?.addSubview(label); panel.contentView?.addSubview(detail); panel.contentView?.addSubview(progress)
        window = panel; panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process(), output = Pipe(), errors = Pipe()
            process.executableURL = URL(fileURLWithPath: self.node)
            process.arguments = [self.root.appendingPathComponent("launcher.mjs").path, "--no-open"]
            process.currentDirectoryURL = self.root; process.standardOutput = output; process.standardError = errors
            do {
                try process.run()
                let result = output.fileHandleForReading.readDataToEndOfFile()
                let error = errors.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let json = (try? JSONSerialization.jsonObject(with: result)) as? [String: Any]
                DispatchQueue.main.async {
                    self.opening = false; self.window?.orderOut(nil)
                    if process.terminationStatus == 0, let address = json?["url"] as? String, let url = URL(string: address) {
                        NSWorkspace.shared.open(url)
                    } else { self.showError(String(data: error, encoding: .utf8) ?? "The studio could not start.") }
                }
            } catch { DispatchQueue.main.async { self.opening = false; self.showError(error.localizedDescription) } }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openStudio(); return false
    }
    @objc func quitStudio() { quitting = true; NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if monitor?.isRunning == true { monitor?.terminate() }
        try? log?.close()
    }
    func showError(_ message: String) {
        window?.orderOut(nil)
        let alert = NSAlert(); alert.messageText = "FWRD.STUDIO.V2 couldn’t open"; alert.informativeText = message
        alert.addButton(withTitle: "OK"); alert.runModal()
    }
}
let app = NSApplication.shared
let delegate = StudioLauncher()
app.setActivationPolicy(.accessory); app.delegate = delegate; app.run()
