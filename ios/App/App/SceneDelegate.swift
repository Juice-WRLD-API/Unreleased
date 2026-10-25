import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = BridgeViewController()
        window?.makeKeyAndVisible()

        for activity in connectionOptions.userActivities where activity.activityType == SiriRadioDonation.activityType {
            SiriCommandCenter.shared.send("play999Fm")
        }

        // Cold launch from an unreleased:// URL (Shortcuts "Open URL").
        SiriCommandCenter.shared.handle(urls: connectionOptions.urlContexts.map { $0.url })

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SiriCommandCenter.shared.handle(urls: URLContexts.map { $0.url })
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if userActivity.activityType == SiriRadioDonation.activityType {
            SiriCommandCenter.shared.send("play999Fm")
        }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
