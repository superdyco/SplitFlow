import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../domain/debug_log.dart';
import 'firestore_refs.dart';

/// 推播 token 的註冊與清除。
///
/// token 存在 `users/{uid}/tokens/{token}`，文件 ID 就是 token 本身 ——
/// 重新註冊時自動覆蓋（冪等），而伺服器端回報某個 token 失效時，
/// 那邊手上正好有那串 token，直接刪那份文件就好。
///
/// 這裡**只管 token 與權限**。決定要通知誰、寫什麼字，全在 Cloud Function
/// （`functions/src/index.ts`）—— client 說了不算，而且離線記帳的通知
/// 本來就只有伺服器端送得出去。
class PushRepository {
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  /// 問使用者要不要接收通知。
  ///
  /// **不要在開 App 當下呼叫。** 那時使用者還不知道這 App 要幹嘛，直接按拒絕
  /// 的機率很高，而 Android 拒絕兩次之後就再也不會跳系統對話框 —— 一旦踩到，
  /// 那個人實務上等於永遠收不到通知。呼叫點在第一次進到某個任務時。
  Future<bool> requestPermission() async {
    final settings = await _messaging.requestPermission();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  /// 現在有沒有通知權限。**不會跳對話框。**
  ///
  /// 用來判斷「該不該問」——已經給過或已經拒絕過的人都不必再問一次。
  Future<bool> hasPermission() async {
    final settings = await _messaging.getNotificationSettings();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  /// 現在拿不拿得到 token。給診斷資訊用 —— 「收不到通知」從畫面上完全
  /// 看不出來，而它跟權限是兩件事（給了權限但 token 沒發出去也會這樣）。
  ///
  /// 問不到就回 null：沒有 Google Play 服務的裝置會直接丟例外，
  /// 那本身就是一條線索，不該跟「有權限但沒 token」混為一談。
  Future<bool?> hasToken() async {
    try {
      final token = await _messaging.getToken();
      return token != null && token.isNotEmpty;
    } catch (_) {
      return null;
    }
  }

  /// 把這台裝置的 token 寫進這個帳號底下。
  ///
  /// 拿不到 token 就安靜地什麼都不做 —— 沒有網路、或使用者拒絕了通知權限
  /// 都會是這個結果，那不該讓任何畫面失敗。
  Future<void> registerToken(String uid) async {
    try {
      // iOS 的 FCM token 建立在 APNs token 之上。權限對話框剛關閉時 APNs
      // 常常還沒回來，立刻 getToken 會丟 apns-token-not-set。短等一下不擋 UI
      // （呼叫端本來就不 await 畫面），仍拿不到就交給 onTokenRefresh 補註冊。
      if (defaultTargetPlatform == TargetPlatform.iOS &&
          !await _waitForApnsToken()) {
        return;
      }

      final token = await _messaging.getToken();
      if (token == null) return;

      await _tokenRef(uid, token).set({
        'platform': pushPlatformName(defaultTargetPlatform),
        'updatedAt': FieldValue.serverTimestamp(),
      });
    } catch (err) {
      // 推播是旁支。APNs/FCM 暫時不可用不能讓任務頁變成未處理例外 ——
      // 但要留下紀錄：使用者只會發現「都沒收到通知」，那從畫面上查不出來。
      logError('push', err);
    }
  }

  /// token 會自己輪替，換新的就寫進去。
  ///
  /// 回傳的是可取消的訂閱：呼叫端負責在登出時停掉，不然換帳號之後舊的
  /// 監聽還會把新 token 寫進前一個人的名下。
  Stream<String> onTokenRefresh() => _messaging.onTokenRefresh;

  /// 刪掉這台裝置在這個帳號底下的 token。
  ///
  /// **登出時必須呼叫，而且要在 signOut() 之前。** 不刪的話，下一個在同一支
  /// 手機登入的人會收到前一個人的旅程通知 —— 那是真的隱私外洩。
  /// 順序也不能反：清掉 auth 之後 `isSelf(uid)` 就不成立，規則會擋下刪除。
  ///
  /// 刪完之後把 token 本身也作廢（`deleteToken`）。只刪 Firestore 那份的話，
  /// 下一個人登入時 `getToken()` 會拿到**同一串** token 並寫進他的名下 ——
  /// 結果是對的，但中間那段時間伺服器手上還有一個指向這台裝置、卻掛在
  /// 前一個帳號下的 token。
  Future<void> removeToken(String uid) async {
    try {
      final token = await _messaging.getToken();
      if (token == null) return;

      await _tokenRef(uid, token).delete();
      await _messaging.deleteToken();
    } catch (_) {
      // 呼叫端仍會完成登出；伺服器送到失效 token 時也會自動清除。
    }
  }

  Future<bool> _waitForApnsToken() async {
    for (var attempt = 0; attempt < 10; attempt++) {
      if (await _messaging.getAPNSToken() != null) return true;
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    return false;
  }

  DocumentReference<Map<String, dynamic>> _tokenRef(String uid, String token) =>
      usersRef.doc(uid).collection('tokens').doc(token);
}

String pushPlatformName(TargetPlatform platform) => switch (platform) {
      TargetPlatform.android => 'android',
      TargetPlatform.iOS => 'ios',
      TargetPlatform.macOS => 'macos',
      TargetPlatform.windows => 'windows',
      TargetPlatform.linux => 'linux',
      TargetPlatform.fuchsia => 'fuchsia',
    };
