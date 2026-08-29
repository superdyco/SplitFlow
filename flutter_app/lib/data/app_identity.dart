import 'package:flutter/services.dart';

import '../domain/app_identity_headers.dart';

/// 這個 App 的身分。
///
/// Android 是套件名 + 簽章 SHA-1，iOS 是 bundle identifier。原生 Maps SDK
/// 會自動送這些資料，但我們直接呼叫 Places REST API，所以必須自己補 header。
///
/// 值是從原生那邊問的（見 `MainActivity.kt`），不是常數：debug、release、
/// Play 重簽是三把不同的簽章，寫死的話換一種建置就壞，而且壞成「搜尋沒反應」。
class AppIdentity {
  static const _channel = MethodChannel('splitflow/app_identity');

  /// 問過一次就記住 —— 這在 App 的生命週期裡不會變。
  static Map<String, String>? _cached;

  /// 拿不到就回 null。尚未支援的平台沒有這個 channel，會直接走這條。
  static Future<Map<String, String>?> headers() async {
    final cached = _cached;
    if (cached != null) return cached;

    try {
      final result = await _channel.invokeMapMethod<String, dynamic>('get');
      return _cached = appIdentityHeaders(result);
    } catch (_) {
      // MissingPluginException（跑在別的平台或測試裡）都算沒有身分。
      // 不送身分 header 的話請求還是會被金鑰擋下來，但那個錯誤訊息
      // 本來就會講清楚，比在這裡炸掉好。
      return null;
    }
  }
}
