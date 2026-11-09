import UIKit

// iOS 18+/yangi SDK'da "Scene lifecycle" qabul qilinmagan ilovalar runtime
// tekshiruvida EXC_BREAKPOINT bilan to'xtaydi (UIApplicationEvaluateRuntimeIssue
// ForNoSceneLifecycleAdoption) — bu ilova faqat eski AppDelegate-asosidagi oynaga
// tayanardi, shu sabab ochilmasdi/qotib qolardi. Main.storyboard'dagi mavjud
// CAPBridgeViewController shu yerda ham ishlatiladi — Capacitor xatti-harakati
// o'zgarmaydi, faqat oyna endi Scene orqali yaratiladi.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        window.rootViewController = storyboard.instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()
    }

}
