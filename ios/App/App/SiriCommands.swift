import Capacitor
import Foundation

// Hand-off between Siri / Shortcuts (App Intents, see SiriIntents.swift) and
// the renderer. Every playback decision stays in JS - same rule as the Android
// media session - so an intent only queues a command here and the WebView
// drains it. The queue is the point: a "Play ..." intent that cold-launches
// the app fires before the bundle has loaded, so a direct evaluateJavaScript
// would be dropped. JS drains on mount (consume) and again on every ping.

struct SiriCommand {
    let action: String
    let query: String?

    var payload: [String: Any] {
        var out: [String: Any] = ["action": action]
        if let query = query { out["query"] = query }
        return out
    }
}

enum SiriSongTitles {
    private static let key = "siriSongTitles"

    static func store(_ titles: [String]) {
        UserDefaults.standard.set(titles, forKey: key)
    }

    static func load() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }
}

final class SiriCommandCenter {
    static let shared = SiriCommandCenter()

    private let lock = NSLock()
    private var pending: [SiriCommand] = []
    // Weak: the plugin is owned by the bridge, which dies with the scene.
    weak var plugin: SiriCommandsPlugin?

    func send(_ action: String, query: String? = nil) {
        lock.lock()
        pending.append(SiriCommand(action: action, query: query))
        lock.unlock()
        DispatchQueue.main.async { self.pingWhenReady(attempt: 0) }
    }

    private func pingWhenReady(attempt: Int) {
        if plugin != nil {
            plugin?.ping()
            return
        }
        guard attempt < 40 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.pingWhenReady(attempt: attempt + 1) }
    }

    // unreleased://<action>[?song=<query>] - the route that survives
    // sideloading. Sideloadly re-signs under a different bundle ID, which
    // leaves App Intents unregistered; a URL scheme doesn't care, and
    // Shortcuts' "Open URL" action (named for Siri) reaches it.
    private static let urlActions: [String: String] = [
        "play": "play", "resume": "play", "pause": "pause",
        "next": "next", "previous": "previous", "prev": "previous",
        "shuffle": "toggleShuffle", "like": "like", "song": "playSong",
    ]

    func handle(urls: [URL]) {
        for url in urls where url.scheme?.lowercased() == "unreleased" {
            guard let action = SiriCommandCenter.urlActions[(url.host ?? "").lowercased()] else { continue }
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "song" || $0.name == "q" })?.value
            if action == "playSong" && (query ?? "").isEmpty { continue }
            send(action, query: query)
        }
    }

    func drain() -> [SiriCommand] {
        lock.lock()
        defer { lock.unlock() }
        let out = pending
        pending = []
        return out
    }
}

@objc(SiriCommandsPlugin)
public class SiriCommandsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SiriCommandsPlugin"
    public let jsName = "SiriCommands"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSongTitles", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        SiriCommandCenter.shared.plugin = self
    }

    func ping() {
        // retainUntilConsumed: a ping that lands before JS has attached its
        // listener is replayed when it does.
        notifyListeners("command", data: [:], retainUntilConsumed: true)
    }

    @objc func consume(_ call: CAPPluginCall) {
        call.resolve(["commands": SiriCommandCenter.shared.drain().map { $0.payload }])
    }

    @objc func setSongTitles(_ call: CAPPluginCall) {
        let titles = call.getArray("titles", String.self) ?? []
        SiriSongTitles.store(titles)
        if #available(iOS 16.0, *) {
            UnreleasedShortcuts.updateAppShortcutParameters()
        }
        call.resolve()
    }
}

// Registers the plugin. Local (non-SPM) Capacitor plugins have to be added by
// hand; SceneDelegate instantiates this instead of CAPBridgeViewController.
class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SiriCommandsPlugin())
        bridge?.registerPluginInstance(LocalLibraryPlugin())
    }
}
