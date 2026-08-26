import Cocoa
import WebKit
import UniformTypeIdentifiers

final class PresenterApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var currentURL: URL?
    private var webReady = false
    private var queuedURL: URL?
    private var queuedPresent = false
    private var queuedSlide: String?
    private var knownModification: Date?
    private var fileWatchTimer: Timer?
    private var togglingFullscreenFromJS = false

    private func diagnostic(_ message: String) {
        guard let path = ProcessInfo.processInfo.environment["MORROW_PRESENTER_DIAGNOSTIC_LOG"], !path.isEmpty else { return }
        let line = "\(message)\n"
        let url = URL(fileURLWithPath: path)
        if let handle = try? FileHandle(forWritingTo: url) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(line.utf8))
            try? handle.close()
        } else {
            try? line.write(to: url, atomically: true, encoding: .utf8)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        parseLaunchArguments()
        buildMenu()
        buildWindow()
        loadFrontend()
        startFileWatcher()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        guard let first = filenames.first else {
            sender.reply(toOpenOrPrint: .failure)
            return
        }
        let url = URL(fileURLWithPath: first)
        if webReady {
            loadDeck(url: url, present: false, slideRef: nil)
        } else {
            queuedURL = url
        }
        sender.reply(toOpenOrPrint: .success)
    }

    private func parseLaunchArguments() {
        let args = Array(CommandLine.arguments.dropFirst())
        var i = 0
        var deckPath: String?
        while i < args.count {
            switch args[i] {
            case "--present":
                queuedPresent = true
            case "--slide":
                if i + 1 < args.count {
                    queuedSlide = args[i + 1]
                    i += 1
                }
            default:
                if !args[i].hasPrefix("-") { deckPath = args[i] }
            }
            i += 1
        }
        if let deckPath { queuedURL = URL(fileURLWithPath: deckPath) }
    }

    private func buildWindow() {
        let contentController = WKUserContentController()
        contentController.add(self, name: "presenter")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Morrow Presenter"
        window.minSize = NSSize(width: 860, height: 560)
        window.center()
        window.contentView = webView
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
    }

    private func loadFrontend() {
        guard let resourceURL = Bundle.main.resourceURL else { return }
        let indexURL = resourceURL.appendingPathComponent("index.html")
        webView.loadFileURL(indexURL, allowingReadAccessTo: resourceURL)
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Morrow Presenter", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Morrow Presenter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileItem.submenu = fileMenu
        fileMenu.addItem(menuItem("New", key: "n", modifiers: [.command], action: #selector(menuNew)))
        fileMenu.addItem(menuItem("Open…", key: "o", modifiers: [.command], action: #selector(menuOpen)))
        fileMenu.addItem(.separator())
        fileMenu.addItem(menuItem("Save", key: "s", modifiers: [.command], action: #selector(menuSave)))
        fileMenu.addItem(menuItem("Save As…", key: "S", modifiers: [.command, .shift], action: #selector(menuSaveAs)))

        let presentationItem = NSMenuItem()
        main.addItem(presentationItem)
        let presentationMenu = NSMenu(title: "Presentation")
        presentationItem.submenu = presentationMenu
        presentationMenu.addItem(menuItem("Start Presentation", key: "\r", modifiers: [.command], action: #selector(menuPresent)))

        NSApp.mainMenu = main
    }

    private func menuItem(_ title: String, key: String, modifiers: NSEvent.ModifierFlags, action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = self
        return item
    }

    @objc private func menuNew() { evaluate("window.presenterMenuAction?.('new')") }
    @objc private func menuOpen() { showOpenPanel() }
    @objc private func menuSave() { evaluate("window.presenterMenuAction?.('save')") }
    @objc private func menuSaveAs() { evaluate("window.presenterMenuAction?.('saveAs')") }
    @objc private func menuPresent() { evaluate("window.presenterMenuAction?.('present')") }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "presenter", let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }
        switch action {
        case "ready":
            webReady = true
            if let queuedURL {
                let url = queuedURL
                let present = queuedPresent
                let slide = queuedSlide
                self.queuedURL = nil
                self.queuedPresent = false
                self.queuedSlide = nil
                loadDeck(url: url, present: present, slideRef: slide)
            } else {
                sendDocumentContext(path: nil)
            }
        case "open":
            showOpenPanel()
        case "new":
            currentURL = nil
            knownModification = nil
            window.title = "Untitled deck — Morrow Presenter"
            sendDocumentContext(path: nil)
        case "save":
            guard let deck = payload["deck"] else { return }
            save(deck: deck, forcePanel: currentURL == nil)
        case "saveAs":
            guard let deck = payload["deck"] else { return }
            save(deck: deck, forcePanel: true)
        case "autosave":
            guard currentURL != nil, let deck = payload["deck"] else { return }
            save(deck: deck, forcePanel: false, notify: true)
        case "presentStart":
            enterFullscreenIfNeeded()
        case "presentEnd":
            exitFullscreenIfNeeded()
        default:
            break
        }
    }

    private func showOpenPanel() {
        let panel = NSOpenPanel()
        panel.title = "Open Morrow Presenter Deck"
        panel.allowedContentTypes = [UTType(filenameExtension: "morrowdeck")!, .json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        if panel.runModal() == .OK, let url = panel.url {
            loadDeck(url: url, present: false, slideRef: nil)
        }
    }

    private func save(deck: Any, forcePanel: Bool, notify: Bool = true) {
        var target = currentURL
        if forcePanel || target == nil {
            let panel = NSSavePanel()
            panel.title = "Save Morrow Presenter Deck"
            panel.allowedContentTypes = [UTType(filenameExtension: "morrowdeck")!]
            panel.nameFieldStringValue = suggestedFilename()
            guard panel.runModal() == .OK, let url = panel.url else { return }
            target = url
        }
        guard let target else { return }
        do {
            guard JSONSerialization.isValidJSONObject(deck) else { throw NSError(domain: "MorrowPresenter", code: 1, userInfo: [NSLocalizedDescriptionKey: "Deck is not valid JSON"] ) }
            let data = try JSONSerialization.data(withJSONObject: deck, options: [.prettyPrinted, .sortedKeys])
            var bytes = data
            bytes.append(0x0A)
            try bytes.write(to: target, options: .atomic)
            currentURL = target
            knownModification = modificationDate(target)
            updateWindowTitle(for: target)
            if notify { sendSaved(path: target.path) }
        } catch {
            showError("Could not save deck", error: error)
        }
    }

    private func suggestedFilename() -> String {
        if let currentURL { return currentURL.lastPathComponent }
        return "Untitled.morrowdeck"
    }

    private func loadDeck(url: URL, present: Bool, slideRef: String?) {
        do {
            let raw = try String(contentsOf: url, encoding: .utf8)
            currentURL = url
            knownModification = modificationDate(url)
            updateWindowTitle(for: url)
            diagnostic("opened \(url.path)")
            let payload: [String: Any] = [
                "json": raw,
                "path": url.path,
                "present": present,
                "slide": slideRef ?? NSNull(),
            ]
            send(function: "window.presenterNativeLoad", payload: payload)
        } catch {
            showError("Could not open deck", error: error)
        }
    }

    private func updateWindowTitle(for url: URL) {
        window.title = "\(url.deletingPathExtension().lastPathComponent) — Morrow Presenter"
    }

    private func sendSaved(path: String) {
        send(function: "window.presenterNativeSaved", payload: ["path": path])
    }

    private func sendDocumentContext(path: String?) {
        let value: Any = path.map { $0 as Any } ?? NSNull()
        let payload: [String: Any] = ["path": value]
        send(function: "window.presenterNativeContext", payload: payload)
    }

    private func send(function: String, payload: Any) {
        guard JSONSerialization.isValidJSONObject(payload), let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        evaluate("\(function)?.(\(json))")
    }

    private func evaluate(_ javascript: String) {
        DispatchQueue.main.async { [weak self] in self?.webView.evaluateJavaScript(javascript, completionHandler: nil) }
    }

    private func showError(_ title: String, error: Error) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = error.localizedDescription
        alert.alertStyle = .warning
        alert.runModal()
    }

    private func enterFullscreenIfNeeded() {
        guard !window.styleMask.contains(.fullScreen) else { return }
        togglingFullscreenFromJS = true
        window.toggleFullScreen(nil)
    }

    private func exitFullscreenIfNeeded() {
        guard window.styleMask.contains(.fullScreen) else { return }
        togglingFullscreenFromJS = true
        window.toggleFullScreen(nil)
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        togglingFullscreenFromJS = false
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        if togglingFullscreenFromJS {
            togglingFullscreenFromJS = false
        } else {
            evaluate("window.presenterNativeFullscreenEnded?.()")
        }
    }

    private func startFileWatcher() {
        fileWatchTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkExternalChange()
        }
    }

    private func checkExternalChange() {
        guard webReady, let url = currentURL, let current = modificationDate(url), let known = knownModification else { return }
        if current.timeIntervalSince1970 > known.timeIntervalSince1970 + 0.0001 {
            knownModification = current
            do {
                let raw = try String(contentsOf: url, encoding: .utf8)
                diagnostic("reloaded \(url.path)")
                send(function: "window.presenterNativeExternalLoad", payload: ["json": raw, "path": url.path])
            } catch {
                // The next watcher tick will retry if the file becomes readable again.
            }
        }
    }

    private func modificationDate(_ url: URL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
    }
}

let app = NSApplication.shared
let delegate = PresenterApp()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
