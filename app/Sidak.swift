// Sidak: the arc-live-folders PR review board as a macOS menu-bar panel.
// Loads panel.html from the extension folder through a custom URL scheme, with shim.js standing in for chrome.*.
import Cocoa
import WebKit
import Carbon.HIToolbox
import UserNotifications
import ServiceManagement
import Network

// ⌃⌥P opens or closes the board from anywhere (a Carbon hot key needs no accessibility permission).
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
// SIDAK_STATE points the watcher at a copy for a dry run (bin/pr-board, run from here, reads the same variable).
let statePath = ProcessInfo.processInfo.environment["SIDAK_STATE"] ?? dir.appendingPathComponent("state.json").path
// Notifications are off (the gauge shows runs as they go); true requests authorization and posts settled reviews again.
let notify = false
// The island is off: the pill keeps the plain count while reviews run (the gauge turns amber); true stretches it to "crm#123 Deep 4:05 +1".
let island = false

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

final class App: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, WKScriptMessageHandlerWithReply, WKUIDelegate, WKNavigationDelegate, NSWindowDelegate {
  // One menu-bar item: the inbox count; Mine is a view inside the board (Tab or a sideways swipe).
  var item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  var title = ""
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
    // The page is transparent over the panel's glass; the material follows the system appearance.
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 440, height: 640), configuration: cfg)
    web.setValue(false, forKey: "drawsBackground")
    web.underPageBackgroundColor = .clear
    web.uiDelegate = self
    web.navigationDelegate = self
    web.load(URLRequest(url: URL(string: "sidak://local/panel.html")!))
    // The one container for the page, for good: it hangs under the pill like a menu, or floats pinned.
    embed(web, in: panel.contentView!)
    placeItem()
    UNUserNotificationCenter.current().delegate = self
    if notify { UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { ok, err in NSLog("notifications: %d %@", ok, err?.localizedDescription ?? "") } }
    watchState()
    // An item created while the menu bar is hidden (a fullscreen space in front) stays off-screen for good; re-place it when apps switch.
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in
      if (self.item.button?.window?.frame.origin.y ?? -1) <= 0 { self.placeItem() }
    }
    if ProcessInfo.processInfo.environment["SIDAK_SHOW"] != nil { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.toggle() } }
    // WebKit pauses the page while the panel is hidden, so the title count comes from pr-board on a timer.
    counts()
    schedulePoll()
    installHotKey(self)
    if let data = try? Data(contentsOf: dir.appendingPathComponent("config.json")),
       let r = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["remote"] as? [String: Any] {
      remotePort = UInt16(r["port"] as? Int ?? 8787)
      remote = r
      serve(port: remotePort)
      applyPhone()
    }
    // Launch at login so the gauge is always up; switch it off in System Settings > General > Login Items.
    if SMAppService.mainApp.status != .enabled { try? SMAppService.mainApp.register() }
  }

  func placeItem() {
    NSStatusBar.system.removeStatusItem(item)
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.image = gauge()
    item.button?.imagePosition = .imageLeading
    // A black capsule in a light or dark menu bar: the gauge and the title draw white on it.
    item.button?.wantsLayer = true
    item.button?.layer?.backgroundColor = NSColor(srgbRed: 10 / 255, green: 10 / 255, blue: 12 / 255, alpha: 1).cgColor
    item.button?.layer?.cornerRadius = 11
    showTitle()
    item.button?.target = self
    item.button?.action = #selector(toggle)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      NSLog("placed item: %@", NSStringFromRect(self.item.button?.window?.frame ?? .zero))
    }
  }

  // The ring as a battery gauge: filled by the reviewed share of the queue, an amber segment for runs in progress,
  // red when under a fifth is done. Not a template (it carries colour); white, on the black pill.
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
      arc(0, 0.9999, NSColor.white.withAlphaComponent(0.25))
      let fill = CGFloat(done) / CGFloat(total), run = CGFloat(live) / CGFloat(total)
      if fill > 0 { arc(0, fill, todo > 0 && fill < 0.2 ? .systemRed : .white) }
      if run > 0 { arc(fill, fill + run, .systemOrange) }
      // Auto review on: an "A" in the middle of the ring, since its runs spend money without a click.
      if auto {
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 7.5, weight: .bold), .foregroundColor: NSColor.white]
        let a = NSAttributedString(string: "A", attributes: attrs)
        let size = a.size()
        a.draw(at: NSPoint(x: 8 - size.width / 2, y: 8 - size.height / 2))
      }
      return true
    }
    image.accessibilityDescription = "Sidak"
    return image
  }

  // One glass panel holds the page. Unpinned (the default) it hangs under the pill and goes away when it loses focus, like a menu.
  // Pinned (sidakpin://1, p on the page, or a drag by its top strip) it floats over every space like Raycast Notes and stays put:
  // where it was dragged, remembered in UserDefaults panelTopLeft, else where it already is.
  var pinned = false
  var dragging = false
  var autoHidden = Date.distantPast
  lazy var panel: NSPanel = {
    let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 640), styleMask: [.nonactivatingPanel, .fullSizeContentView, .titled, .closable], backing: .buffered, defer: false)
    p.titlebarAppearsTransparent = true
    p.titleVisibility = .hidden
    // No traffic lights: they would sit on the page's header. Closing (performClose) still unpins.
    for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { p.standardWindowButton(b)?.isHidden = true }
    p.isMovableByWindowBackground = true
    // Floating, not popUpMenu, so the page's confirm() alerts (modal panel level) still come up above it.
    p.level = .floating
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    p.hidesOnDeactivate = false
    p.isReleasedWhenClosed = false
    p.isOpaque = false
    p.backgroundColor = .clear
    p.delegate = self
    p.contentView = glassView(radius: 30)
    // The web view takes every click, so the page's top 14 px are the strip that moves the panel (and pins it, see windowDidMove).
    NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { [unowned self] e in
      if e.type == .leftMouseUp { dragging = false; return e }
      guard e.window === p, e.locationInWindow.y > p.frame.height - 14 else { return e }
      dragging = true
      p.performDrag(with: e)
      return nil
    }
    return p
  }()
  // Unpin moves the panel back under the pill, still open.
  func setPinned(_ on: Bool, at corner: NSPoint? = nil) {
    guard on != pinned else { if on { panel.makeKeyAndOrderFront(nil) }; return }
    pinned = on
    if on {
      let saved = UserDefaults.standard.string(forKey: "panelTopLeft").map(NSPointFromString)
        .flatMap { p in NSScreen.screens.contains { $0.frame.contains(NSPoint(x: p.x + 1, y: p.y - 1)) } ? p : nil }
      if let top = corner ?? saved { panel.setFrameTopLeftPoint(top) }
    } else {
      panel.setFrameTopLeftPoint(underItem())
    }
    show()
    // For the page's p key and styling: whether it is pinned now (the close and drag paths change it too).
    web.evaluateJavaScript("document.documentElement.dataset.pinned = '\(on ? 1 : 0)'")
  }
  func show() {
    panel.makeKeyAndOrderFront(nil)
    panel.invalidateShadow()
    NSApp.activate(ignoringOtherApps: true)
    panel.makeFirstResponder(web)
    // The page was paused while hidden: ask background.js for a fresh sync.
    web.evaluateJavaScript("chrome.storage.local.set({ syncRequest: Date.now() })")
  }
  // Real Liquid Glass on macOS 26 (NSGlassEffectView), tinted toward near-black in dark mode; the older blur material before that.
  func glassView(radius: CGFloat) -> NSView {
    if #available(macOS 26, *) {
      let g = NSGlassEffectView()
      g.cornerRadius = radius
      g.tintColor = NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 0, alpha: 0.28) : NSColor(white: 1, alpha: 0.12) }
      return g
    }
    let v = NSVisualEffectView()
    v.material = .popover
    v.blendingMode = .behindWindow
    v.state = .active
    v.wantsLayer = true
    v.layer?.cornerRadius = radius
    v.layer?.masksToBounds = true
    return v
  }
  // The glass view holds the page as its contentView; the fallback just as a subview.
  func embed(_ v: NSView, in glass: NSView) {
    v.frame = glass.bounds
    v.autoresizingMask = [.width, .height]
    if #available(macOS 26, *), let g = glass as? NSGlassEffectView { g.contentView = v } else { glass.addSubview(v) }
  }
  func detach(_ v: NSView) {
    if #available(macOS 26, *), let g = v.superview as? NSGlassEffectView, g.contentView === v { g.contentView = nil }
    v.removeFromSuperview()
  }
  // Top-left corner 6 px under the menu bar, centred on the status item, kept on its screen.
  func underItem() -> NSPoint {
    let f = item.button?.window?.frame ?? .zero
    let screen = item.button?.window?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
    return NSPoint(x: min(max(f.midX - 220, screen.minX + 8), screen.maxX - 448), y: f.minY - 6)
  }
  func windowShouldClose(_ w: NSWindow) -> Bool {
    if w === panel { setPinned(false); return false }
    return true
  }
  func windowDidMove(_ n: Notification) {
    guard n.object as? NSWindow === panel else { return }
    let top = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
    // Dragged off its place under the pill by the top strip: it stays there, pinned.
    if !pinned, dragging, NSEvent.pressedMouseButtons & 1 == 1 { dragging = false; setPinned(true, at: top) }
    if pinned { UserDefaults.standard.set(NSStringFromPoint(top), forKey: "panelTopLeft") }
  }
  // Unpinned, it goes away when focus moves elsewhere (another app, a click outside), not for one of its own alerts.
  func windowDidResignKey(_ n: Notification) {
    guard n.object as? NSWindow === panel, !pinned else { return }
    DispatchQueue.main.async { [self] in
      guard !pinned, !panel.isKeyWindow, NSApp.modalWindow == nil, panel.isVisible else { return }
      panel.orderOut(nil)
      autoHidden = Date()
    }
  }

  // A review that settles (state.json flips to reviewed or failed) refreshes the counts and, with notify, posts a notification;
  // clicking it opens the PR. The file is watched, so this fires within a second of the write, and the pill refreshes with it.
  var stateSource: DispatchSourceFileSystemObject?
  var lastStates: [String: String]?
  func watchState() {
    let path = statePath
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
    if notify { UNUserNotificationCenter.current().getNotificationSettings { NSLog("notification status: %ld", $0.authorizationStatus.rawValue) } }
  }
  func stateChanged() {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: statePath)),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { return }
    let states = json.mapValues { $0["state"] as? String ?? "" }
    defer { lastStates = states }
    // A run older than two hours is a closed tab that never settled (pr-board auto skips those too); keep it off the pill.
    let cutoff = Date().timeIntervalSince1970 * 1000 - 2 * 3600 * 1000
    runs = json.filter { $0.value["state"] as? String == "running" && (($0.value["at"] as? NSNumber)?.doubleValue ?? 0) > cutoff }
      .map { (key: $0.key, quick: $0.value["depth"] as? String == "quick", at: ($0.value["at"] as? NSNumber)?.doubleValue ?? 0) }
    showTitle()
    guard let last = lastStates else { return }  // first read: nothing to announce
    var settled = false
    for (key, state) in states where state != last[key] && (state == "reviewed" || state == "failed") {
      settled = true
      // key: owner/repo#123
      let parts = key.split(separator: "#")
      guard notify, parts.count == 2 else { continue }
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

  // The item and ⌃⌥P: pinned, bring the panel forward; unpinned, open it under the pill or close it.
  @objc func toggle() {
    if pinned { show(); return }
    if panel.isVisible { panel.orderOut(nil); return }
    // The click on the item that took focus from the panel already closed it: that click must not reopen it.
    if Date().timeIntervalSince(autoHidden) < 0.25 { return }
    panel.setFrameTopLeftPoint(underItem())
    show()
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

  func savedSettings() -> [String: Any]? {
    (try? Data(contentsOf: dir.appendingPathComponent("settings.json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
  }

  // pr-board runs every settings.json pollMinutes (1, 2, 5 or 10; default 2): read at launch and again when the page saves settings.
  var pollTimer: Timer?
  func schedulePoll() {
    let minutes = savedSettings()?["pollMinutes"] as? Int ?? 2
    let interval = TimeInterval([1, 2, 5, 10].contains(minutes) ? minutes : 2) * 60
    pollTimer?.invalidate()
    // With the phone on, the poll also syncs the app's page: WebKit pauses its own 5-minute alarm while the panel is closed.
    pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
      self.counts()
      if self.listener != nil { self.web.evaluateJavaScript("sync()") }
    }
    NSLog("poll every %.0f s", interval)
  }

  // While reviews run, the title names the most recently started one and its time so far ("crm#123 Deep 4:05 +1"),
  // redrawn every 30 s by a timer that exists only while something runs; otherwise the plain count.
  var runs: [(key: String, quick: Bool, at: Double)] = []
  var runTick: Timer?
  func showTitle() {
    var text = title
    if island, let run = runs.max(by: { $0.at < $1.at }) {
      let secs = max(0, Int(Date().timeIntervalSince1970 - run.at / 1000))
      let name = run.key.split(separator: "/").last.map(String.init) ?? run.key
      text = " \(name) \(run.quick ? "Skim" : "Deep") \(secs / 60):\(String(format: "%02d", secs % 60))" + (runs.count > 1 ? " +\(runs.count - 1)" : "")
      if runTick == nil { runTick = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in self.showTitle() } }
    } else { runTick?.invalidate(); runTick = nil }
    item.button?.attributedTitle = NSAttributedString(string: text, attributes: [.foregroundColor: NSColor.white, .font: NSFont.menuBarFont(ofSize: 0)])
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
        self.showTitle()
        self.item.button?.image = self.gauge()
        self.item.button?.toolTip = "\(toReview) to review, \(running) running, \(reviewed) reviewed" + (autoOn ? " · \(auto)" : "")
      }
    }
  }

  // shim.js → here. "review": run the opener like the Arc native host does.
  func userContentController(_ ucc: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard let body = m.body as? [String: Any], let kind = body["kind"] as? String else { replyHandler(nil, "bad message"); return }
    // sidakheight://<px>: the page's height after a render. The panel fits it (240 to 760 px) and keeps its top edge.
    // Not an action: nothing runs and nothing closes.
    if let url = body["url"] as? String, url.hasPrefix("sidakheight://") {
      let px = Double(url.dropFirst("sidakheight://".count).trimmingCharacters(in: CharacterSet(charactersIn: "/"))) ?? 0
      NSLog("page height: %@", url)
      if px > 0 {
        let height = min(max(px, 240), 760)
        panel.animator().setFrame(NSRect(x: panel.frame.minX, y: panel.frame.maxY - height, width: 440, height: height), display: true)
      }
      replyHandler(["ok": true], nil)
      return
    }
    // sidakpin://1 pins the panel where it is (or where it was last pinned), sidakpin://0 hangs it under the pill again. Not an action either.
    if let url = body["url"] as? String, url.hasPrefix("sidakpin://") {
      NSLog("pin: %@", url)
      replyHandler(["ok": true], nil)
      let on = url.dropFirst("sidakpin://".count).trimmingCharacters(in: CharacterSet(charactersIn: "/")) == "1"
      DispatchQueue.main.async { self.setPinned(on) }
      return
    }
    switch kind {
    case "log":
      NSLog("page: %@", body["text"] as? String ?? "")
      replyHandler(nil, nil)
    case "review":
      let url = body["url"] as? String ?? ""
      // Settings, nudges and mark-ready run in place; only the cmux openers close the unpinned panel and bring cmux forward.
      let inPlace = ["ccset:", "ccnudge:", "ccready:", "ccopen:"].contains { url.hasPrefix($0) }
      if !inPlace && !pinned { panel.orderOut(nil) }
      act(url, front: !inPlace) { ok, text in replyHandler(["ok": ok, "error": text], nil) }
    default:
      replyHandler(nil, "unknown message \(kind)")
    }
  }

  // Runs one board action through bin/claude-review-open, as the Arc native host does; front brings cmux forward after.
  func act(_ url: String, front: Bool, done: @escaping (Bool, String) -> Void) {
    DispatchQueue.global().async {
      let p = Process()
      p.executableURL = URL(fileURLWithPath: "/bin/zsh")
      p.currentDirectoryURL = dir
      p.arguments = ["-c", "CMUX_QUIET=1 CMUX_SOCKET_PASSWORD=$(tr -d '[:space:]' < ~/.config/cmux/socket-password) bin/claude-review-open \"$1\" && { [ -z \"$2\" ] || osascript -e 'tell application \"cmux\" to activate'; }", "_", url, front ? "1" : ""]
      let out = Pipe()
      p.standardOutput = out
      p.standardError = out
      try? p.run()
      p.waitUntilExit()
      let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      DispatchQueue.main.async {
        done(p.terminationStatus == 0, text)
        // A settings change (auto on/off, stale cut-off, poll interval) redraws the gauge now and restarts the poll timer.
        // Phone off stops the tunnel a moment later, so a switch-off from the phone still gets its reply.
        if url.hasPrefix("ccset:") { self.counts(); self.schedulePoll(); DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.applyPhone() } }
      }
    }
  }

  // Phone access, on when config.json has "remote": the board over 127.0.0.1:<port>, which only cloudflared reaches, and cloudflared
  // only with a valid Cloudflare Access login. GET serves the page with app/remote.js, its files and the board's lists; POST /act runs
  // an action like a tap on the board. Nothing else in the repo is served: token.txt and handoffs/ never leave the Mac.
  var listener: NWListener?
  let served = ["panel.js", "pr.js", "lg.css", "app/remote.js", "state.json", "settings.json", "config.json"]
  // Every action the board sends, minus Zed (it opens on the Mac's screen); sidaksync: is the phone's refresh button.
  let remoteActions = ["ccreview:", "ccfix:", "ccmerge:", "ccnudge:", "ccready:", "ccset:", "sidaksync:"]
  func serve(port: UInt16) {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!)
    guard let l = try? NWListener(using: params) else { NSLog("remote: no listener on %d", port); return }
    l.newConnectionHandler = { c in c.start(queue: .main); self.read(c, Data()) }
    l.stateUpdateHandler = { NSLog("remote: %@", "\($0)") }
    l.start(queue: .main)
    listener = l
  }
  // One request per connection: the head, then Content-Length bytes of body.
  func read(_ c: NWConnection, _ buf: Data) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, error in
      let buf = buf + (data ?? Data())
      let more = { if done || error != nil || buf.count > 1 << 20 { c.cancel() } else { self.read(c, buf) } }
      guard let end = buf.range(of: Data("\r\n\r\n".utf8)) else { return more() }
      let lines = String(decoding: buf[..<end.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
      var headers: [String: String] = [:]
      for line in lines.dropFirst() {
        let kv = line.split(separator: ":", maxSplits: 1)
        if kv.count == 2 { headers[kv[0].lowercased()] = kv[1].trimmingCharacters(in: .whitespaces) }
      }
      let body = buf[end.upperBound...]
      guard body.count >= Int(headers["content-length"] ?? "0") ?? 0 else { return more() }
      let request = lines[0].split(separator: " ")
      let path = request.count > 1 ? String(request[1].split(separator: "?").first ?? "/") : "/"
      self.respond(c, String(request.first ?? ""), path, headers, Data(body))
    }
  }
  func respond(_ c: NWConnection, _ method: String, _ path: String, _ headers: [String: String], _ body: Data) {
    let file = String(path.dropFirst())
    switch (method, path) {
    case ("GET", "/"), ("GET", "/panel.html"):
      // The page as the app loads it, with remote.js standing in for chrome.* and a phone-width viewport.
      let html = (try? String(contentsOf: dir.appendingPathComponent("panel.html"), encoding: .utf8)) ?? ""
      let head = "<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n<script src=\"app/remote.js\"></script>"
      send(c, 200, "text/html", Data(html.replacingOccurrences(of: "<meta charset=\"utf-8\" />", with: head).utf8))
    case ("GET", "/storage.json"):
      // The app page's chrome.storage (shim.js keeps it in localStorage under s:): the PR lists and when they synced.
      web.evaluateJavaScript("JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('s:')).map((k) => [k.slice(2), JSON.parse(localStorage[k])])))") { out, _ in
        self.send(c, 200, "application/json", Data((out as? String ?? "{}").utf8))
      }
    case ("POST", "/act"):
      // Only the page sends X-Sidak: another site posting through the logged-in phone browser can't set it without a CORS preflight,
      // and preflights get no answer here.
      guard headers["x-sidak"] == "1", let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            let url = json["url"] as? String, remoteActions.contains(where: url.hasPrefix) else { return send(c, 403, "text/plain", Data("forbidden".utf8)) }
      NSLog("remote: %@", url)
      let reply = { (ok: Bool, text: String) in
        self.send(c, 200, "application/json", (try? JSONSerialization.data(withJSONObject: ["ok": ok, "error": text])) ?? Data())
      }
      // Refresh: one sync in the app's page, answered when its lists are written.
      if url.hasPrefix("sidaksync:") {
        web.callAsyncJavaScript("sync(); await queue", arguments: [:], in: nil, in: .page) { _ in reply(true, "") }
      } else {
        act(url, front: false, done: reply)
      }
    case ("GET", _) where served.contains(file):
      let types = ["js": "text/javascript", "json": "application/json", "css": "text/css"]
      let data = (try? Data(contentsOf: dir.appendingPathComponent(file))) ?? Data("{}".utf8)
      send(c, 200, types[(file as NSString).pathExtension] ?? "text/plain", data)
    default:
      send(c, 404, "text/plain", Data("not found".utf8))
    }
  }
  func send(_ c: NWConnection, _ status: Int, _ type: String, _ data: Data) {
    let head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "No")\r\nContent-Type: \(type); charset=utf-8\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
    c.send(content: Data(head.utf8) + data, completion: .contentProcessed { _ in c.cancel() })
  }

  // cloudflared for the phone, only once config.json names the Access team and app (remote.team, remote.aud): it checks that login on
  // every request before passing it on. A killed app leaves its cloudflared behind, so a launch stops any old one first.
  var tunnel: Process?, remote: [String: Any]?, remotePort: UInt16 = 8787
  // settings.json phone (default on) runs or stops the tunnel; the server stays up, since only cloudflared reaches it.
  func applyPhone() {
    guard let r = remote else { return }
    if savedSettings()?["phone"] as? Bool ?? true { if tunnel == nil { runTunnel(r, port: remotePort) } }
    else if let t = tunnel { tunnel = nil; t.terminationHandler = nil; t.terminate() }
  }
  let tunnelConfig = NSTemporaryDirectory() + "sidak-tunnel.yml"
  func runTunnel(_ r: [String: Any], port: UInt16) {
    if tunnel == nil { let k = Process(); k.executableURL = URL(fileURLWithPath: "/usr/bin/pkill"); k.arguments = ["-f", tunnelConfig]; try? k.run(); k.waitUntilExit() }
    guard let team = r["team"] as? String, !team.isEmpty, let aud = r["aud"] as? String, !aud.isEmpty, let host = r["hostname"] as? String,
          let bin = ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"].first(where: FileManager.default.isExecutableFile) else {
      NSLog("remote: tunnel off (needs remote.hostname, team, aud and cloudflared)"); return
    }
    let name = r["tunnel"] as? String ?? "sidak"
    let yml = """
      ingress:
        - hostname: \(host)
          service: http://127.0.0.1:\(port)
          originRequest:
            access: { required: true, teamName: \(team), audTag: [\(aud)] }
        - service: http_status:404

      """
    try? yml.write(toFile: tunnelConfig, atomically: true, encoding: .utf8)
    let p = Process()
    p.executableURL = URL(fileURLWithPath: bin)
    p.arguments = ["tunnel", "--no-autoupdate", "--logfile", NSHomeDirectory() + "/Library/Logs/Sidak-tunnel.log", "--config", tunnelConfig, "run", name]
    p.terminationHandler = { _ in DispatchQueue.main.asyncAfter(deadline: .now() + 10) { if self.tunnel === p { self.runTunnel(r, port: port) } } }
    do { try p.run(); tunnel = p } catch { NSLog("remote: cloudflared: %@", error.localizedDescription) }
  }
  func applicationWillTerminate(_ n: Notification) { tunnel?.terminationHandler = nil; tunnel?.terminate() }

  // Links on cards are target=_blank, and any http(s) navigation belongs in the browser, not the panel.
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
