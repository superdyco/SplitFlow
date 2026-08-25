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

class AuthRepository {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  User? get currentUser => _auth.currentUser;

  /// 登入狀態的變化。畫面用它決定要顯示登入頁還是任務列表。
  Stream<User?> authStateChanges() => _auth.authStateChanges();

  /// Google 登入。
  ///
  /// 錯誤碼交給領域層的 `describeSignInError` 翻譯 —— 那支同時認得
  /// `auth/` 前綴與不帶前綴的寫法，所以兩個版本共用同一份訊息。
  Future<User> signInWithGoogle() async {
    try {
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

  Future<void> signOut() async {
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
