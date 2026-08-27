import Cocoa
import CryptoKit
import WebKit
import UniformTypeIdentifiers
import ImageIO

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
        fileMenu.addItem(.separator())
        fileMenu.addItem(menuItem("Export PDF…", key: "", modifiers: [], action: #selector(menuExportPDF)))
        fileMenu.addItem(menuItem("Export PowerPoint…", key: "", modifiers: [], action: #selector(menuExportPPTX)))

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        editMenu.addItem(menuItem("Undo", key: "z", modifiers: [.command], action: #selector(menuUndo)))
        editMenu.addItem(menuItem("Redo", key: "z", modifiers: [.command, .shift], action: #selector(menuRedo)))
        editMenu.addItem(.separator())
        editMenu.addItem(menuItem("Cut", key: "x", modifiers: [.command], action: #selector(menuCut)))
        editMenu.addItem(menuItem("Copy", key: "c", modifiers: [.command], action: #selector(menuCopy)))
        editMenu.addItem(menuItem("Paste", key: "v", modifiers: [.command], action: #selector(menuPaste)))
        editMenu.addItem(menuItem("Select All", key: "a", modifiers: [.command], action: #selector(menuSelectAll)))

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
    @objc private func menuExportPDF() { evaluate("window.presenterMenuAction?.('exportPdf')") }
    @objc private func menuExportPPTX() { evaluate("window.presenterMenuAction?.('exportPptx')") }
    @objc private func menuUndo() { evaluate("window.presenterMenuAction?.('undo')") }
    @objc private func menuRedo() { evaluate("window.presenterMenuAction?.('redo')") }
    @objc private func menuCut() { evaluate("window.presenterMenuAction?.('cut')") }
    @objc private func menuCopy() { evaluate("window.presenterMenuAction?.('copy')") }
    @objc private func menuPaste() { evaluate("window.presenterMenuAction?.('paste')") }
    @objc private func menuSelectAll() { evaluate("window.presenterMenuAction?.('selectAll')") }
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
                if ProcessInfo.processInfo.environment["MORROW_PRESENTER_DIAGNOSTIC_SELFTEST"] == "1" {
                    evaluate("window.presenterDiagnosticSelfTest?.()")
                }
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
        case "exportPdf":
            guard let deck = payload["deck"] else { return }
            exportDeck(deck: deck, kind: "pdf")
        case "exportPptx":
            guard let deck = payload["deck"] else { return }
            exportDeck(deck: deck, kind: "pptx")
        case "chooseImage":
            guard let deck = payload["deck"] else { return }
            chooseImage(deck: deck)
        case "loadAsset":
            guard let path = payload["path"] as? String, let requestId = payload["requestId"] as? String else { return }
            loadAsset(path: path, requestId: requestId)
        case "assetRendered":
            if let path = payload["path"] as? String { diagnostic("rendered \(path)") }
        case "runtimeError":
            if let message = payload["message"] as? String { diagnostic("js-error \(message)") }
        case "diagnostic":
            if let message = payload["message"] as? String { diagnostic(message) }
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
        var types: [UTType] = [UTType(filenameExtension: "morrowdeck")!, .json]
        if let pptx = UTType(filenameExtension: "pptx") { types.append(pptx) }
        panel.allowedContentTypes = types
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        if panel.runModal() == .OK, let url = panel.url {
            if url.pathExtension.lowercased() == "pptx" { importPowerPoint(source: url) }
            else { loadDeck(url: url, present: false, slideRef: nil) }
        }
    }

    private func importPowerPoint(source: URL) {
        guard let uv = uvExecutable(), let resourceURL = Bundle.main.resourceURL else {
            showError("Could not import PowerPoint", error: NSError(domain: "MorrowPresenter", code: 30, userInfo: [NSLocalizedDescriptionKey: "uv is required for PPTX import"])); return
        }
        let helper = resourceURL.appendingPathComponent("Scripts/import-pptx.py")
        guard FileManager.default.fileExists(atPath: helper.path) else {
            showError("Could not import PowerPoint", error: NSError(domain: "MorrowPresenter", code: 31, userInfo: [NSLocalizedDescriptionKey: "Bundled PPTX import helper is missing"])); return
        }
        let panel = NSSavePanel(); panel.title = "Import PowerPoint as Morrow Deck"
        panel.allowedContentTypes = [UTType(filenameExtension: "morrowdeck")!]
        panel.nameFieldStringValue = source.deletingPathExtension().lastPathComponent + ".morrowdeck"
        guard panel.runModal() == .OK, let output = panel.url else { return }
        do {
            let process = Process(); let stderr = Pipe(); process.executableURL = uv
            process.arguments = ["run", "--script", helper.path, source.path, output.path]
            process.standardError = stderr; process.standardOutput = Pipe(); try process.run(); process.waitUntilExit()
            if process.terminationStatus != 0 {
                let detail = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "Unknown import error"
                throw NSError(domain: "MorrowPresenter", code: 32, userInfo: [NSLocalizedDescriptionKey: detail])
            }
            diagnostic("imported pptx \(source.path) -> \(output.path)")
            loadDeck(url: output, present: false, slideRef: nil)
        } catch { showError("Could not import PowerPoint", error: error) }
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
        let previousURL = currentURL
        do {
            guard JSONSerialization.isValidJSONObject(deck) else { throw NSError(domain: "MorrowPresenter", code: 1, userInfo: [NSLocalizedDescriptionKey: "Deck is not valid JSON"] ) }
            if previousURL != target { try copyReferencedAssets(deck: deck, from: previousURL, to: target) }
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

    private func uvExecutable() -> URL? {
        var candidates: [String] = []
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates.append(contentsOf: path.split(separator: ":").map { String($0) + "/uv" })
        }
        candidates.append(contentsOf: [
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/uv").path,
            "/opt/homebrew/bin/uv", "/usr/local/bin/uv"
        ])
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }
        return nil
    }

    private func exportDeck(deck: Any, kind: String) {
        if currentURL == nil { save(deck: deck, forcePanel: true, notify: true) }
        guard let deckURL = currentURL else { return }
        // Persist the exact state being exported before invoking the helper.
        save(deck: deck, forcePanel: false, notify: true)
        guard let uv = uvExecutable(), let resourceURL = Bundle.main.resourceURL else {
            showError("Could not export", error: NSError(domain: "MorrowPresenter", code: 20, userInfo: [NSLocalizedDescriptionKey: "uv is required for PDF/PPTX export"])); return
        }
        let ext = kind == "pdf" ? "pdf" : "pptx"
        let helper = resourceURL.appendingPathComponent("Scripts/export-\(ext).py")
        guard FileManager.default.fileExists(atPath: helper.path) else {
            showError("Could not export", error: NSError(domain: "MorrowPresenter", code: 21, userInfo: [NSLocalizedDescriptionKey: "Bundled export helper is missing"])); return
        }
        let panel = NSSavePanel()
        panel.title = kind == "pdf" ? "Export PDF" : "Export PowerPoint"
        if kind == "pdf" { panel.allowedContentTypes = [.pdf] }
        else if let pptx = UTType(filenameExtension: "pptx") { panel.allowedContentTypes = [pptx] }
        panel.nameFieldStringValue = deckURL.deletingPathExtension().lastPathComponent + "." + ext
        guard panel.runModal() == .OK, let output = panel.url else { return }
        do {
            let process = Process(); let stderr = Pipe(); let stdout = Pipe()
            process.executableURL = uv
            process.arguments = ["run", "--script", helper.path, deckURL.path, output.path]
            process.standardError = stderr; process.standardOutput = stdout
            try process.run(); process.waitUntilExit()
            if process.terminationStatus != 0 {
                let data = stderr.fileHandleForReading.readDataToEndOfFile()
                let detail = String(data: data, encoding: .utf8) ?? "Unknown export error"
                throw NSError(domain: "MorrowPresenter", code: 22, userInfo: [NSLocalizedDescriptionKey: detail])
            }
            diagnostic("exported \(kind) \(output.path)")
            send(function: "window.presenterNativeExported", payload: ["path": output.path, "format": kind])
        } catch { showError("Could not export \(kind.uppercased())", error: error) }
    }

    private func chooseImage(deck: Any) {
        if currentURL == nil {
            save(deck: deck, forcePanel: true, notify: true)
        }
        guard let deckURL = currentURL else { return }

        let panel = NSOpenPanel()
        panel.title = "Choose Image"
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let source = panel.url else { return }

        do {
            let relative = try importAsset(source: source, for: deckURL)
            let dimensions = imagePixelDimensions(source)
            send(function: "window.presenterNativeImageChosen", payload: [
                "path": relative,
                "name": source.deletingPathExtension().lastPathComponent,
                "width": dimensions.width,
                "height": dimensions.height,
            ])
        } catch {
            showError("Could not add image", error: error)
        }
    }

    private func imagePixelDimensions(_ source: URL) -> (width: Int, height: Int) {
        guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber else {
            return (16, 9)
        }
        return (max(1, width.intValue), max(1, height.intValue))
    }

    private func importAsset(source: URL, for deckURL: URL) throws -> String {
        let supported = Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"])
        let ext = source.pathExtension.lowercased()
        guard supported.contains(ext) else {
            throw NSError(domain: "MorrowPresenter", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unsupported image type: .\(ext)"])
        }
        let data = try Data(contentsOf: source)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let relative = ".morrow-assets/\(String(digest.prefix(24))).\(ext)"
        let target = deckURL.deletingLastPathComponent().appendingPathComponent(relative)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: target.path) {
            try data.write(to: target, options: .atomic)
        }
        return relative
    }

    private func loadAsset(path: String, requestId: String) {
        guard let deckURL = currentURL else {
            sendAssetError(requestId: requestId, path: path, message: "Deck must be saved before loading assets")
            return
        }
        do {
            let url = try resolvedAssetURL(relativePath: path, deckURL: deckURL)
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            if let size = values.fileSize, size > 32 * 1024 * 1024 {
                throw NSError(domain: "MorrowPresenter", code: 3, userInfo: [NSLocalizedDescriptionKey: "Image exceeds 32 MB preview limit"])
            }
            let data = try Data(contentsOf: url)
            diagnostic("asset \(path)")
            let dataURL = "data:\(mimeType(for: url));base64,\(data.base64EncodedString())"
            send(function: "window.presenterNativeAsset", payload: [
                "requestId": requestId,
                "path": path,
                "dataURL": dataURL,
            ])
        } catch {
            sendAssetError(requestId: requestId, path: path, message: error.localizedDescription)
        }
    }

    private func sendAssetError(requestId: String, path: String, message: String) {
        send(function: "window.presenterNativeAsset", payload: [
            "requestId": requestId,
            "path": path,
            "error": message,
        ])
    }

    private func resolvedAssetURL(relativePath: String, deckURL: URL) throws -> URL {
        let parts = relativePath.split(separator: "/", omittingEmptySubsequences: false)
        guard !relativePath.hasPrefix("/"), !parts.contains("..") else {
            throw NSError(domain: "MorrowPresenter", code: 4, userInfo: [NSLocalizedDescriptionKey: "Asset path must be a safe relative path"])
        }
        let base = deckURL.deletingLastPathComponent().standardizedFileURL
        let resolved = base.appendingPathComponent(relativePath).standardizedFileURL
        let prefix = base.path.hasSuffix("/") ? base.path : base.path + "/"
        guard resolved.path.hasPrefix(prefix) else {
            throw NSError(domain: "MorrowPresenter", code: 5, userInfo: [NSLocalizedDescriptionKey: "Asset path escapes deck directory"])
        }
        return resolved
    }

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        default: return "application/octet-stream"
        }
    }

    private func copyReferencedAssets(deck: Any, from sourceDeck: URL?, to targetDeck: URL) throws {
        guard let sourceDeck else { return }
        let sourceBase = sourceDeck.deletingLastPathComponent().standardizedFileURL
        let targetBase = targetDeck.deletingLastPathComponent().standardizedFileURL
        if sourceBase == targetBase { return }
        guard let object = deck as? [String: Any], let slides = object["slides"] as? [[String: Any]] else { return }

        var paths = Set<String>()
        for slide in slides {
            // Legacy single-image decks are still portable during migration.
            if let image = slide["image"] as? [String: Any], let path = image["path"] as? String {
                paths.insert(path)
            }
            if let elements = slide["elements"] as? [[String: Any]] {
                for element in elements where (element["type"] as? String) == "image" {
                    if let path = element["path"] as? String { paths.insert(path) }
                }
            }
        }

        for path in paths {
            let source = try resolvedAssetURL(relativePath: path, deckURL: sourceDeck)
            guard FileManager.default.fileExists(atPath: source.path) else { continue }
            let target = try resolvedAssetURL(relativePath: path, deckURL: targetDeck)
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: target.path) {
                try FileManager.default.copyItem(at: source, to: target)
            }
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
