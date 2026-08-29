import Flutter
import GoogleMaps
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var identityChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Maps SDK for iOS 只能從原生端初始化。金鑰來自不進版控的
    // Flutter/Secrets.xcconfig，沒設定時保持停用，其他功能仍可使用。
    if let mapsKey = Bundle.main.object(forInfoDictionaryKey: "GoogleMapsApiKey") as? String,
      !mapsKey.isEmpty,
      !mapsKey.hasPrefix("$(")
    {
      GMSServices.provideAPIKey(mapsKey)
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    // Places REST API 的 iOS 應用程式限制需要 bundle identifier header。
    // 跟 Android 的 package + SHA-1 共用同一條 MethodChannel。
    let channel = FlutterMethodChannel(
      name: "splitflow/app_identity",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    channel.setMethodCallHandler { call, result in
      guard call.method == "get" else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard let bundleId = Bundle.main.bundleIdentifier else {
        result(nil)
        return
      }
      result(["iosBundleId": bundleId])
    }
    identityChannel = channel
  }
}
