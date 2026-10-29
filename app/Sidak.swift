// Sidak: the arc-live-folders PR review board as a macOS menu-bar popover.
// Loads panel.html from the extension folder through a custom URL scheme, with shim.js standing in for chrome.*.
import Cocoa
import WebKit
import Carbon.HIToolbox
import UserNotifications
import ServiceManagement

// ⌃⌥P opens or closes the popover from anywhere (a Carbon hot key needs no accessibility permission).
var hotKeyRef: EventHotKeyRef?
func installHotKey(_ app: App) {
  var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
  InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
    Unmanaged<App>.fromOpaque(userData!).takeUnretainedValue().toggle()
    return noErr
  }, 1, &spec, Unmanaged.passUnretained(app).toOpaque(), nil)
  let id = EventHotKeyID(signature: OSType(0x5344_414B), id: 1)
  let status = RegisterEventHotKey(UInt32(kVK_ANSI_P), UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
  NSLog("hot key ⌃⌥P: %d", status)
}

// The repo folder (the one above app/): build.sh writes it into Info.plist. Scripts run from there, as bin/<name>.
let dir = URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "SidakDir") as! String)

final class Files: NSObject, WKURLSchemeHandler {
  let types = ["html": "text/html", "js": "text/javascript", "json": "application/json", "txt": "text/plain",
               "png": "image/png", "svg": "image/svg+xml", "css": "text/css"]
  func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url!
    let file = dir.appendingPathComponent(url.path.isEmpty ? "/panel.html" : url.path)
    guard let data = try? Data(contentsOf: file) else { task.didFailWithError(NSError(domain: "sidak", code: 404)); return }
    let headers = ["Content-Type": types[file.pathExtension] ?? "application/octet-stream", "Cache-Control": "no-store"]
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers)!)
    task.didReceive(data)
    task.didFinish()
  }
  func webView(_ w: WKWebView, stop task: WKURLSchemeTask) {}
}

final class App: NSObject, NSApplicationDelegate, NSPopoverDelegate, UNUserNotificationCenterDelegate, WKScriptMessageHandlerWithReply, WKUIDelegate, WKNavigationDelegate {
  // One menu-bar item: the inbox count; Mine is a view inside the board (Tab or a sideways swipe).
  var item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  var title = ""
  let popover = NSPopover()
  var web: WKWebView!

  func applicationDidFinishLaunching(_ n: Notification) {
    let cfg = WKWebViewConfiguration()
    cfg.setURLSchemeHandler(Files(), forURLScheme: "sidak")
    let ucc = cfg.userContentController
    ucc.addScriptMessageHandler(self, contentWorld: .page, name: "sidak")
    for (name, when) in [("app/shim.js", WKUserScriptInjectionTime.atDocumentStart), ("background.js", .atDocumentEnd)] {
      let src = try! String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8)
      ucc.addUserScript(WKUserScript(source: src, injectionTime: when, forMainFrameOnly: true))
    }
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 440, height: 640), configuration: cfg)
    web.uiDelegate = self
    web.navigationDelegate = self
    web.load(URLRequest(url: URL(string: "sidak://local/panel.html")!))
    let vc = NSViewController()
    vc.view = web
    popover.contentViewController = vc
    popover.contentSize = web.frame.size
    popover.behavior = .transient
    // Drag the popover off the menu bar and it stays as its own window (resizable: the page has a wide layout from 760 px).
    popover.delegate = self
    web.autoresizingMask = [.width, .height]
    placeItem()
    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { ok, err in NSLog("notifications: %d %@", ok, err?.localizedDescription ?? "") }
    watchState()
    // An item created while the menu bar is hidden (a fullscreen space in front) stays off-screen for good; re-place it when apps switch.
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in
      if (self.item.button?.window?.frame.origin.y ?? -1) <= 0 { self.placeItem() }
    }
    if ProcessInfo.processInfo.environment["SIDAK_SHOW"] != nil { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.toggle() } }
    // WebKit pauses the page while the popover is closed, so the title count comes from pr-board on a timer.
    counts()
    Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { _ in self.counts() }
    installHotKey(self)
    // Launch at login so the gauge is always up; switch it off in System Settings > General > Login Items.
    if SMAppService.mainApp.status != .enabled { try? SMAppService.mainApp.register() }
  }

  func placeItem() {
    NSStatusBar.system.removeStatusItem(item)
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.image = gauge()
    item.button?.imagePosition = .imageLeading
    item.button?.title = title
    item.button?.target = self
    item.button?.action = #selector(toggle)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      NSLog("placed item: %@", NSStringFromRect(self.item.button?.window?.frame ?? .zero))
    }
  }

  // The ring as a battery gauge: filled by the reviewed share of the queue, an amber segment for runs in progress,
  // red when under a fifth is done. Not a template (it carries colour); labelColor resolves per menu bar appearance.
  var toReview = 0, running = 0, reviewed = 0, autoOn = false
  func gauge() -> NSImage {
    let (todo, live, done, auto) = (toReview, running, reviewed, autoOn)
    let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { _ in
      let total = max(todo + live + done, 1)
      let arc = { (from: CGFloat, to: CGFloat, color: NSColor) in
        let p = NSBezierPath()
        p.appendArc(withCenter: NSPoint(x: 8, y: 8), radius: 5.5, startAngle: 90 - from * 360, endAngle: 90 - to * 360, clockwise: true)
        p.lineWidth = 2; p.lineCapStyle = .butt; color.setStroke(); p.stroke()
      }
      arc(0, 0.9999, NSColor.labelColor.withAlphaComponent(0.25))
      let fill = CGFloat(done) / CGFloat(total), run = CGFloat(live) / CGFloat(total)
      if fill > 0 { arc(0, fill, todo > 0 && fill < 0.2 ? .systemRed : .labelColor) }
      if run > 0 { arc(fill, fill + run, .systemOrange) }
      // Auto review on: an "A" in the middle of the ring, since its runs spend money without a click.
      if auto {
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 7.5, weight: .bold), .foregroundColor: NSColor.labelColor]
        let a = NSAttributedString(string: "A", attributes: attrs)
        let size = a.size()
        a.draw(at: NSPoint(x: 8 - size.width / 2, y: 8 - size.height / 2))
      }
      return true
    }
    image.accessibilityDescription = "Sidak"
    return image
  }

  func popoverShouldDetach(_ popover: NSPopover) -> Bool { true }

  // A review that settles (state.json flips to reviewed or failed) posts a notification; clicking it opens the PR.
  // The file is watched, so this fires within a second of the write, and the gauge refreshes at the same time.
  var stateSource: DispatchSourceFileSystemObject?
  var lastStates: [String: String]?
  func watchState() {
    let path = dir.appendingPathComponent("state.json").path
    let fd = open(path, O_EVTONLY)
    guard fd >= 0 else { NSLog("state.json not watchable"); return }
    let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .extend, .delete, .rename], queue: .main)
    source.setEventHandler { [self] in
      let gone = source.data.contains(.delete) || source.data.contains(.rename)
      NSLog("state.json changed (%lu)", source.data.rawValue)
      // Debounce: json.dump truncates then writes; read once the file is whole.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
        stateChanged()
        if gone { source.cancel(); watchState() }
      }
    }
    source.setCancelHandler { close(fd) }
    source.resume()
    stateSource = source
    stateChanged()
    UNUserNotificationCenter.current().getNotificationSettings { NSLog("notification status: %ld", $0.authorizationStatus.rawValue) }
  }
  func stateChanged() {
    guard let data = try? Data(contentsOf: dir.appendingPathComponent("state.json")),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { return }
    let states = json.mapValues { $0["state"] as? String ?? "" }
    defer { lastStates = states }
    guard let last = lastStates else { return }  // first read: nothing to announce
    var settled = false
    for (key, state) in states where state != last[key] && (state == "reviewed" || state == "failed") {
      settled = true
      // key: owner/repo#123
      let parts = key.split(separator: "#")
      guard parts.count == 2 else { continue }
      let content = UNMutableNotificationContent()
      content.title = state == "reviewed" ? ["approved": "Approved", "changes": "Changes requested", "commented": "Commented"][json[key]?["verdict"] as? String ?? ""] ?? "Review posted" : "Review failed"
      content.body = String(parts[0].split(separator: "/").last ?? parts[0]) + "#" + parts[1] + (json[key]?["depth"] as? String == "quick" ? " (skim)" : "")
      content.userInfo = ["url": "https://github.com/\(parts[0])/pull/\(parts[1])"]
      content.sound = .default
      UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: key, content: content, trigger: nil)) { err in
        NSLog("notified %@: %@", key, err?.localizedDescription ?? "ok")
      }
    }
    if settled { counts() }
  }
  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    if let s = r.notification.request.content.userInfo["url"] as? String, let u = URL(string: s) { NSWorkspace.shared.open(u) }
    done()
  }
  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }

  @objc func toggle() {
    // Detached: the page lives in its own window now; the hot key and the menu bar item bring it forward.
    if !popover.isShown, let window = web.window, window.isVisible {
      window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
      web.evaluateJavaScript("chrome.storage.local.set({ syncRequest: Date.now() })")
      return
    }
    if popover.isShown { popover.performClose(nil); return }
    popover.show(relativeTo: item.button!.bounds, of: item.button!, preferredEdge: .minY)
    NSApp.activate(ignoringOtherApps: true)
    web.window?.makeFirstResponder(web)
    // The page was paused while hidden: ask background.js for a fresh sync.
    web.evaluateJavaScript("chrome.storage.local.set({ syncRequest: Date.now() })")
  }

  // A zsh command line's stdout and exit status.
  func zsh(_ command: String) -> (String, Int32) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-c", command]
    p.currentDirectoryURL = dir
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    try? p.run()
    let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    p.waitUntilExit()
    return (text, p.terminationStatus)
  }

  // "<to review> ↻<running>" beside the icon, parsed from `pr-board board` (indented lines under each section).
  // Then one auto-review tick (`pr-board auto`); while auto mode is on the title reads "A <to review>", since its runs spend money.
  func counts() {
    DispatchQueue.global().async {
      let (text, status) = self.zsh("bin/pr-board board")
      var section = "", toReview = 0, running = 0, reviewed = 0
      for line in text.split(separator: "\n") {
        if !line.hasPrefix("  ") { section = String(line); continue }
        if section == "To review" { toReview += 1 } else if section == "Running" { running += 1 } else if section == "Reviewed" { reviewed += 1 }
      }
      NSLog("counts: to review %d, running %d, reviewed %d", toReview, running, reviewed)
      let auto = self.zsh("bin/pr-board auto").0.split(separator: "\n").first.map(String.init) ?? ""
      NSLog("auto: %@", auto)
      let autoOn = auto.hasPrefix("auto on")
      let title = status == 0 ? " \(toReview)" : ""
      DispatchQueue.main.async {
        (self.toReview, self.running, self.reviewed, self.autoOn) = (toReview, running, reviewed, autoOn)
        self.title = title
        self.item.button?.title = title
        self.item.button?.image = self.gauge()
        self.item.button?.toolTip = "\(toReview) to review, \(running) running, \(reviewed) reviewed" + (autoOn ? " · \(auto)" : "")
      }
    }
  }

  // shim.js → here. "review": run the opener like the Arc native host does.
  func userContentController(_ ucc: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard let body = m.body as? [String: Any], let kind = body["kind"] as? String else { replyHandler(nil, "bad message"); return }
    switch kind {
    case "log":
      NSLog("page: %@", body["text"] as? String ?? "")
      replyHandler(nil, nil)
    case "review":
      let url = body["url"] as? String ?? ""
      // Settings, nudges and mark-ready run in place; only the cmux openers close the popover and bring cmux forward.
      let inPlace = ["ccset:", "ccnudge:", "ccready:", "ccopen:"].contains { url.hasPrefix($0) }
      if !inPlace { popover.performClose(nil) }
      DispatchQueue.global().async {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.currentDirectoryURL = dir
        p.arguments = ["-c", "CMUX_QUIET=1 CMUX_SOCKET_PASSWORD=$(tr -d '[:space:]' < ~/.config/cmux/socket-password) bin/claude-review-open \"$1\" && { [ -n \"$2\" ] || osascript -e 'tell application \"cmux\" to activate'; }", "_", url, inPlace ? "1" : ""]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = out
        try? p.run()
        p.waitUntilExit()
        let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        DispatchQueue.main.async {
          replyHandler(["ok": p.terminationStatus == 0, "error": text], nil)
          // A settings change (auto on/off, stale cut-off) redraws the gauge now instead of at the next 2-minute tick.
          if url.hasPrefix("ccset:") { self.counts() }
        }
      }
    default:
      replyHandler(nil, "unknown message \(kind)")
    }
  }

  // Links on cards are target=_blank, and any http(s) navigation belongs in the browser, not the popover.
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = a.request.url { NSWorkspace.shared.open(u) }
    return nil
  }
  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let u = a.request.url, ["http", "https"].contains(u.scheme ?? "") { NSWorkspace.shared.open(u); decisionHandler(.cancel) } else { decisionHandler(.allow) }
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { NSLog("loaded %@", w.url?.absoluteString ?? "") }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { NSLog("load failed: %@", e.localizedDescription) }
  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { NSLog("nav failed: %@", e.localizedDescription) }
  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = "Sidak"; a.informativeText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    completionHandler(a.runModal() == .alertFirstButtonReturn)
  }
  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = "Sidak"; a.informativeText = message; a.runModal(); completionHandler()
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = App()
app.delegate = delegate
app.run()
