import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private let lifetime = Pipe()
    private var timer: Timer?
    private var attempts = 0
    private var checking = false
    private var quitting = false
    private var downloads: [ObjectIdentifier: (temporary: URL, destination: URL)] = [:]
    private let token = UUID().uuidString
    private let origin = "http://127.0.0.1:47831"
    private let dataDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Lyrica", isDirectory: true)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        makeMenu()
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Lyrica"
        window.minSize = NSSize(width: 760, height: 580)
        window.contentView = webView
        window.setFrameAutosaveName("LyricaMainWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.loadHTMLString("<html><body style='background:#09090b;color:white;font:20px -apple-system;display:grid;place-items:center;height:90vh'>Lyrica startet …</body></html>", baseURL: nil)
        do { try startServer() } catch { showError(error.localizedDescription) }
    }

    private func makeMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Über Lyrica", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Datenordner öffnen", action: #selector(openData), keyEquivalent: "")
        appMenu.addItem(withTitle: "Lyrica beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Bearbeiten")
        for (title, action, key) in [("Widerrufen", "undo:", "z"), ("Ausschneiden", "cut:", "x"), ("Kopieren", "copy:", "c"), ("Einsetzen", "paste:", "v"), ("Alles auswählen", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    @objc private func openData() { NSWorkspace.shared.open(dataDirectory) }

    private func startServer() throws {
        guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
        try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
        let logURL = dataDirectory.appendingPathComponent("desktop.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try FileHandle(forWritingTo: logURL)
        let process = Process()
        process.executableURL = resources.appendingPathComponent("bin/node")
        process.arguments = [resources.appendingPathComponent("desktop/launcher.cjs").path]
        process.currentDirectoryURL = dataDirectory
        // Finder does not supply a shell PATH. Never inherit Node injection options.
        var environment = ["HOME": NSHomeDirectory(), "TMPDIR": NSTemporaryDirectory(), "LANG": "en_US.UTF-8"]
        environment["PATH"] = resources.appendingPathComponent("bin").path + ":/usr/bin:/bin:/usr/sbin:/sbin"
        environment["NODE_ENV"] = "production"
        environment["LYRICA_RESOURCES"] = resources.path
        environment["LYRICA_DATA"] = dataDirectory.path
        environment["LYRICA_TOKEN"] = token
        environment["CHROME_EXECUTABLE"] = resources.appendingPathComponent("browser/chrome-headless-shell").path
        environment["FFMPEG_PATH"] = resources.appendingPathComponent("bin/ffmpeg").path
        process.environment = environment
        process.standardInput = lifetime
        process.standardOutput = log
        process.standardError = log
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                self.showError("Der lokale Dienst wurde beendet. Details stehen in desktop.log im Datenordner.")
            }
        }
        server = process
        try process.run()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.checkReady() }
    }

    private func checkReady() {
        guard !checking else { return }
        attempts += 1
        if attempts > 120 {
            showError("Der lokale Dienst startet nicht. Prüfe desktop.log im Datenordner und ob Port 47831 frei ist.")
            return
        }
        checking = true
        var request = URLRequest(url: URL(string: origin + "/_desktop/health")!)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.checking = false
                guard !self.quitting, (response as? HTTPURLResponse)?.statusCode == 200 else { return }
                self.timer?.invalidate()
                // Exchange the launch token for an HttpOnly cookie before loading the editor.
                var bootstrap = URLRequest(url: URL(string: self.origin + "/_desktop/session")!)
                bootstrap.setValue("Bearer " + self.token, forHTTPHeaderField: "Authorization")
                self.webView.load(bootstrap)
            }
        }.resume()
    }

    private func showError(_ message: String) {
        timer?.invalidate()
        let alert = NSAlert()
        alert.messageText = "Lyrica konnte nicht gestartet werden"
        alert.informativeText = message
        alert.addButton(withTitle: "Datenordner öffnen")
        alert.addButton(withTitle: "Beenden")
        if alert.runModal() == .alertFirstButtonReturn { openData() }
        NSApp.terminate(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        timer?.invalidate()
        try? lifetime.fileHandleForWriting.close()
        for download in downloads.values { try? FileManager.default.removeItem(at: download.temporary) }
        // The supervisor also receives EOF if the native app crashes.
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
        if url.scheme == "about" || url.scheme == "blob" ||
            (url.scheme == "http" && url.host == "127.0.0.1" && url.port == 47831) {
            decisionHandler(.allow)
        } else {
            if navigationAction.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Lyrica"
        alert.informativeText = message
        alert.addButton(withTitle: "Fortfahren")
        alert.addButton(withTitle: "Abbrechen")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { [weak self] result in
            guard let self, result == .OK, let destination = panel.url else { completionHandler(nil); return }
            // WKDownload requires a nonexistent destination. Replace only after a
            // successful transfer, preserving an existing export if download fails.
            let temporary = destination.deletingLastPathComponent().appendingPathComponent(".lyrica-\(UUID().uuidString).download")
            self.downloads[ObjectIdentifier(download)] = (temporary, destination)
            completionHandler(temporary)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        do {
            if FileManager.default.fileExists(atPath: file.destination.path) {
                _ = try FileManager.default.replaceItemAt(file.destination, withItemAt: file.temporary)
            } else {
                try FileManager.default.moveItem(at: file.temporary, to: file.destination)
            }
        } catch {
            try? FileManager.default.removeItem(at: file.temporary)
            NSAlert(error: error).beginSheetModal(for: window)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = downloads.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: file.temporary)
        }
        let alert = NSAlert(error: error)
        alert.beginSheetModal(for: window)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
