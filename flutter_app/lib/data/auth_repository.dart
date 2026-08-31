/// 登入與使用者資料。`src/services/authService.ts` 與 `userService.ts` 的
/// Dart 版。
///
/// **這裡是網頁版與原生版差最多的一層。** 網頁版用 `signInWithPopup`，那條路
/// 在 iOS PWA 上會載一個跨來源 iframe，量測顯示冷啟動要付 1.6～2.2 秒
/// （桌機只要 0.25 秒），而且在 2026-08-24 那兩次嘗試裡把登入弄壞過兩次。
///
/// 原生沒有這個問題：Google 登入走系統的帳號選擇器，沒有彈窗、沒有 iframe、
/// 沒有 gapi。那正是把記帳搬到原生最直接的好處之一。
library;

import 'package:flutter/foundation.dart';

import '../domain/auth_error.dart' as domain;
import '../domain/models.dart';
import 'firestore_refs.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// 使用者自己取消不算錯誤，呼叫端安靜收掉就好。
class SignInCancelled implements Exception {
  const SignInCancelled();
}

/// Google 登入用的 **web** OAuth client id。
///
/// 名字很容易誤導：Android 上要傳的是 `google-services.json` 裡
/// `client_type: 3`（web）那一個，不是 `client_type: 1`（android）。
/// 傳錯或不傳的話 `google_sign_in` 7.x 會直接丟
/// `clientConfigurationError: serverClientId must be provided on Android`。
///
/// 為什麼是 web 的：Android 那組只是拿來比對 APK 簽章，真正要換 Firebase
/// 憑證的是後端這一組。
///
/// 這不是秘密 —— 它就在版控裡的 google-services.json 中。
const String _serverClientId =
    '816128125030-tinjkkds5qmqqmfbldrhivdc217tmqpa.apps.googleusercontent.com';

/// iOS 原生 OAuth client id。公開識別碼，不是私密金鑰；URL Scheme 是它的反向字串。
const String _iosClientId =
    '816128125030-418l0jhp8hel8golo7nb3c4ccv357pot.apps.googleusercontent.com';

class AuthRepository {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// `initialize` 一個 app 只能呼叫一次，但登入可以按很多次。
  static bool _initialized = false;

  Future<void> _ensureInitialized() async {
    if (_initialized) return;
    await GoogleSignIn.instance.initialize(
      clientId:
          defaultTargetPlatform == TargetPlatform.iOS ? _iosClientId : null,
      serverClientId: _serverClientId,
    );
    _initialized = true;
  }

  User? get currentUser => _auth.currentUser;

  /// 登入狀態的變化。畫面用它決定要顯示登入頁還是任務列表。
  Stream<User?> authStateChanges() => _auth.authStateChanges();

  /// Google 登入。
  ///
  /// 錯誤碼交給領域層的 `describeSignInError` 翻譯 —— 那支同時認得
  /// `auth/` 前綴與不帶前綴的寫法，所以兩個版本共用同一份訊息。
  Future<User> signInWithGoogle() async {
    try {
      await _ensureInitialized();
      final account = await GoogleSignIn.instance.authenticate();

      final credential = GoogleAuthProvider.credential(
        idToken: account.authentication.idToken,
      );

      final result = await _auth.signInWithCredential(credential);
      final user = result.user;
      if (user == null) throw Exception('登入成功但沒有拿到使用者資料');
      return user;
    } on GoogleSignInException catch (err) {
      // 使用者按了返回或關掉帳號選擇器。
      if (err.code == GoogleSignInExceptionCode.canceled) {
        throw const SignInCancelled();
      }
      rethrow;
    } on FirebaseAuthException catch (err) {
      if (domain.isCancelledSignIn(err.code)) throw const SignInCancelled();
      final message = domain.describeSignInError(
        err.code,
        domain.SignInProvider.google,
        err.message ?? err.code,
      );
      throw Exception(message ?? err.code);
    }
  }

  /// Apple 登入。**iOS 上架的硬性要求**（App Store 指引 4.8：提供第三方登入
  /// 就必須同時提供 Sign in with Apple）。
  ///
  /// 用 firebase_auth 自己的 `signInWithProvider` 而不是額外的套件：在 iOS 上
  /// 這條路會走系統原生的授權畫面，nonce 由 SDK 處理，不必多一個相依。
  ///
  /// 姓名只有**第一次**授權時拿得到，之後每次登入都是空的。這裡不特別接 ——
  /// 暱稱本來就在 onboarding 讓使用者自己填，拿不到也不影響。
  ///
  /// 注意使用者可以選「隱藏我的電子郵件」，那時拿到的是
  /// `@privaterelay.appleid.com` 的轉發位址。那是一個合法的 email，個人設定頁
  /// 照樣顯示得出來，但它跟同一個人的 Google 信箱**不是同一個** —— 所以那會
  /// 是另一個帳號，Firebase 不會、也無法把兩者視為衝突。
  Future<User> signInWithApple() async {
    try {
      final provider = AppleAuthProvider()
        ..addScope('email')
        ..addScope('name');

      final result = await _auth.signInWithProvider(provider);
      final user = result.user;
      if (user == null) throw Exception('登入成功但沒有拿到使用者資料');
      return user;
    } on FirebaseAuthException catch (err) {
      if (domain.isCancelledSignIn(err.code)) throw const SignInCancelled();
      final message = domain.describeSignInError(
        err.code,
        domain.SignInProvider.apple,
        err.message ?? err.code,
      );
      throw Exception(message ?? err.code);
    }
  }

  /// 登出。
  ///
  /// [onBeforeSignOut] 在清掉 Firebase Auth **之前**跑，給推播 token 的清除
  /// 用。順序不能反：auth 清掉之後 `isSelf(uid)` 就不成立，規則會擋下刪除，
  /// 而留著會讓下一個在這支手機登入的人收到前一個人的通知。
  ///
  /// 清除失敗不該擋住登出 —— 使用者按了登出就是要離開，卡在那裡更糟。
  Future<void> signOut({Future<void> Function()? onBeforeSignOut}) async {
    if (onBeforeSignOut != null) {
      try {
        await onBeforeSignOut();
      } catch (_) {
        // 沒網路或 token 本來就不在 —— 都不該讓登出失敗。
      }
    }
    await GoogleSignIn.instance.signOut();
    await _auth.signOut();
  }
}

class UserRepository {
  Future<UserProfile?> getProfile(String uid) async {
    final snap = await usersRef.doc(uid).get();
    final data = snap.data();
    if (data == null) return null;
    return UserProfile(
      uid: (data['uid'] as String?) ?? uid,
      nickname: (data['nickname'] as String?) ?? '',
      email: (data['email'] as String?) ?? '',
      photoUrl: data['photoURL'] as String?,
      provider: (data['provider'] as String?) ?? 'unknown',
    );
  }

  /// 用 merge 而不是覆寫：使用者可能已經有資料（換裝置重新登入），
  /// 全量覆寫會把 createdAt 洗掉。
  Future<void> createProfile(User user, String nickname) {
    return usersRef.doc(user.uid).set({
      'uid': user.uid,
      'nickname': nickname,
      'email': user.email ?? '',
      'photoURL': user.photoURL,
      'provider': user.providerData.isEmpty
          ? 'unknown'
          : user.providerData.first.providerId,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  Future<void> updateNickname(String uid, String nickname) {
    return usersRef.doc(uid).update({
      'nickname': nickname,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}
