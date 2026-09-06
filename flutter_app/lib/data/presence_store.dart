import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/presence.dart';
import 'firestore_refs.dart';

/// 記下「這個人今天有來」。
///
/// 規則在 `domain/presence.dart`，這裡只負責讀偏好設定跟送出那一次寫入。
///
/// 每一步都吞掉例外，而且**不回報也不重試**：這是一支旁支，戳記沒寫成，
/// 後台的當日活躍就少算一個人，而使用者什麼感覺都不會有。為它加重試，
/// 會讓一個「不重要到可以整支不執行」的東西開始有狀態。
class PresenceStore {
  static const _key = 'splitflow:last-seen';

  /// 這一輪已經蓋過哪一天。
  ///
  /// 有 SharedPreferences 為什麼還要它：偏好設定讀寫失敗時（極少，但會發生）
  /// 只靠它的話，每次 provider 重算都會再寫一次 Firestore。
  String? _stampedFor;

  /// 網頁版寫 `"web"`，這裡照裝置分。三個值跟規則裡的白名單一字不差 ——
  /// 對不上的話規則會擋下來，而擋下來的症狀是「Android 的數字永遠是 0」。
  String get _platform {
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    // 目前只出 Android 與 iOS。真的跑在別的地方時寧可不寫，也不要塞一個
    // 規則不認得的值進去 —— 那會讓整筆寫入被擋，連時間都留不下來。
    return '';
  }

  Future<void> markSeen(String uid) async {
    final today = dayKey(DateTime.now());
    if (!shouldStamp(_stampedFor, today)) return;

    final platform = _platform;
    if (platform.isEmpty) return;

    try {
      final prefs = await SharedPreferences.getInstance();
      if (!shouldStamp(prefs.getString(_key), today)) {
        _stampedFor = today;
        return;
      }
      // 先記下來再送出。等成功才記的話，離線開啟就會每次都排一筆寫入進佇列，
      // 回到連線時那些寫入會一起送出，全部指向同一份文件、寫同一個值。
      _stampedFor = today;
      await prefs.setString(_key, today);
    } catch (_) {
      // 偏好設定壞了就靠 _stampedFor 撐這一輪。
      _stampedFor = today;
    }

    try {
      await usersRef.doc(uid).update({
        // serverTimestamp() 在規則裡就等於 request.time，而規則要求兩者相等。
        // 這不是形式：那條規則是「這個戳記不能被偽造」的全部。
        'lastSeenAt': FieldValue.serverTimestamp(),
        'lastPlatform': platform,
      });
    } catch (_) {
      // 沒寫成就算了，見類別註解。
    }
  }
}
