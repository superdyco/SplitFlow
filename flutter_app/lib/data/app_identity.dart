import 'package:flutter/services.dart';

/// 這個 App 的身分：套件名與簽章 SHA-1。
///
/// 拿來組 `X-Android-Package` / `X-Android-Cert` 兩個 header ——
/// Android 限制的 API 金鑰靠它們認人。原生 SDK 自動會送，我們用 REST
/// 直接打的請求不會。
///
/// 值是從原生那邊問的（見 `MainActivity.kt`），不是常數：debug、release、
/// Play 重簽是三把不同的簽章，寫死的話換一種建置就壞，而且壞成「搜尋沒反應」。
class AppIdentity {
  static const _channel = MethodChannel('splitflow/app_identity');

  /// 問過一次就記住 —— 這在 App 的生命週期裡不會變。
  static Map<String, String>? _cached;

  /// 拿不到就回 null。Android 以外的平台沒有這個 channel，會直接走這條。
  static Future<Map<String, String>?> headers() async {
    final cached = _cached;
    if (cached != null) return cached;

    try {
      final result =
          await _channel.invokeMapMethod<String, dynamic>('get');
      final package = result?['package'] as String?;
      final sha1 = result?['sha1'] as String?;
      if (package == null || sha1 == null) return null;

      return _cached = {
        'X-Android-Package': package,
        'X-Android-Cert': sha1,
      };
    } catch (_) {
      // MissingPluginException（跑在別的平台或測試裡）都算沒有身分。
      // 不送這兩個 header 的話請求還是會被金鑰擋下來，但那個錯誤訊息
      // 本來就會講清楚，比在這裡炸掉好。
      return null;
    }
  }
}
