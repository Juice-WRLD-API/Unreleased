import AppIntents
import AVFoundation
import Intents
import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        if #available(iOS 16.0, *) {
            UnreleasedShortcuts.updateAppShortcutParameters()
        }
        return true
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        if userActivity.activityType == SiriRadioDonation.activityType {
            SiriCommandCenter.shared.send("play999Fm")
            return true
        }
        return false
    }

    func application(_ application: UIApplication, handlerFor intent: INIntent) -> Any? {
        intent is INPlayMediaIntent ? PlayMediaIntentHandler() : nil
    }

    // Makes the WebView's <audio> elements behave like a music app instead of
    // a web page: audible with the ringer switch on silent, and still running
    // once the app is backgrounded or the screen locks. Pairs with the `audio`
    // entry in Info.plist's UIBackgroundModes — neither half does anything on
    // its own, and without both the renderer's whole iOS audio strategy is
    // built on a promise the native side never kept: lib/audioEffects.ts
    // deliberately refuses to build the Web Audio graph on iOS (forfeiting
    // EQ / balance / mono / reverb / skip-silence) specifically to protect
    // background playback that wasn't actually enabled here.
    //
    // Category only, never setActive(true): WKWebView activates the session
    // itself when media starts, so claiming it at launch would cut off
    // whatever the user was already listening to just for opening the app to
    // browse. If a device test shows playback still dying on background, an
    // explicit setActive(true) is the next thing to try — at the cost of that
    // interruption. Deliberately no .mixWithOthers either: a music player is
    // meant to take over the output, and mixing forfeits the lock-screen Now
    // Playing controls the renderer drives via the Web MediaSession API (see
    // Player.tsx's mediaSession effects).
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        } catch {
            // Non-fatal — leaves the default WebView behaviour (foreground
            // only, silenced by the ringer switch), which is what shipped
            // before this existed.
            print("AVAudioSession setup failed, background audio unavailable: \(error)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
