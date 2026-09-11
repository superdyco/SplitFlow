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
import '../domain/guest.dart';
import '../domain/models.dart';
import 'firestore_refs.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// 使用者自己取消不算錯誤，呼叫端安靜收掉就好。
class SignInCancelled implements Exception {
  const SignInCancelled();
}

/// 訪客綁定帳號的結果。
///
/// 那個帳號以前就登入過時不是錯誤，而是另一種結果：畫面要問使用者要不要合併。
sealed class LinkOutcome {
  const LinkOutcome();
}

/// 綁定成功，uid 不變。
class Linked extends LinkOutcome {
  final User user;
  const Linked(this.user);
}

/// 那個帳號已經有資料。拿著它的 credential，由畫面決定要不要合併過去。
class AccountTaken extends LinkOutcome {
  final AuthCredential credential;
  const AccountTaken(this.credential);
}

String _providerIdOfUser(User user) => providerIdOf(
      isAnonymous: user.isAnonymous,
      providerIds: user.providerData.map((info) => info.providerId).toList(),
    );

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

  /// 免登入試用。拿到的是一個真的匿名帳號 —— 建任務、記帳、加入別人的任務
  /// 都跟正式帳號一樣，rules 不必為它開任何例外。
  Future<User> signInAsGuest() async {
    try {
      final result = await _auth.signInAnonymously();
      final user = result.user;
      if (user == null) throw Exception('登入成功但沒有拿到使用者資料');
      return user;
    } on FirebaseAuthException catch (err) {
      if (err.code == 'operation-not-allowed') {
        throw Exception('免登入試用還沒有在 Firebase Console 啟用。');
      }
      rethrow;
    }
  }

  User _requireGuest() {
    final user = _auth.currentUser;
    if (user == null || !user.isAnonymous) throw Exception('只有訪客需要綁定帳號');
    return user;
  }

  /// 綁定失敗時的訊息。同一個 email 已經用別的方式註冊過，跟登入時是同一句話。
  Exception _linkError(FirebaseAuthException err, domain.SignInProvider provider) {
    if (domain.isCancelledSignIn(err.code)) return const SignInCancelled();
    if (err.code == 'email-already-in-use' ||
        err.code == 'account-exists-with-different-credential') {
      return Exception(domain.existingAccountMessage(err.email ?? '', const []));
    }
    final message =
        domain.describeSignInError(err.code, provider, err.message ?? err.code);
    return Exception(message ?? err.code);
  }

  /// 訪客綁定 Google。成功的話 **uid 不變**，所有任務原封不動。
  ///
  /// Google 的 credential 是自己用帳號選擇器拿到的，撞到已存在的帳號時手上
  /// 本來就有，不必靠錯誤物件帶回來（有帶就用帶回來的）。
  Future<LinkOutcome> linkWithGoogle() async {
    final user = _requireGuest();
    try {
      await _ensureInitialized();
      final account = await GoogleSignIn.instance.authenticate();
      final credential = GoogleAuthProvider.credential(
        idToken: account.authentication.idToken,
      );
      try {
        final result = await user.linkWithCredential(credential);
        return Linked(result.user ?? user);
      } on FirebaseAuthException catch (err) {
        if (err.code == 'credential-already-in-use') {
          return AccountTaken(err.credential ?? credential);
        }
        rethrow;
      }
    } on GoogleSignInException catch (err) {
      if (err.code == GoogleSignInExceptionCode.canceled) {
        throw const SignInCancelled();
      }
      rethrow;
    } on FirebaseAuthException catch (err) {
      throw _linkError(err, domain.SignInProvider.google);
    }
  }

  /// 訪客綁定 Apple。撞到已存在的帳號時，credential 只能從錯誤物件拿。
  Future<LinkOutcome> linkWithApple() async {
    final user = _requireGuest();
    try {
      final provider = AppleAuthProvider()
        ..addScope('email')
        ..addScope('name');
      final result = await user.linkWithProvider(provider);
      return Linked(result.user ?? user);
    } on FirebaseAuthException catch (err) {
      final credential = err.credential;
      if (err.code == 'credential-already-in-use' && credential != null) {
        return AccountTaken(credential);
      }
      throw _linkError(err, domain.SignInProvider.apple);
    }
  }

  /// 訪客的證明。**要在 switchToAccount 之前拿** —— 換過去之後就拿不到了。
  Future<String> guestIdToken() async {
    final token = await _requireGuest().getIdToken();
    if (token == null) throw Exception('拿不到訪客憑證');
    return token;
  }

  /// 換成那個已經存在的帳號。
  Future<User> switchToAccount(AuthCredential credential) async {
    final result = await _auth.signInWithCredential(credential);
    final user = result.user;
    if (user == null) throw Exception('登入成功但沒有拿到使用者資料');
    return user;
  }

  /// 把訪客合併進目前登入的正式帳號。真正的改寫在雲端函式裡，可以重跑。
  Future<void> mergeGuest(String guestToken) async {
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    await FirebaseFunctions.instanceFor(region: 'asia-east1')
        .httpsCallable('mergeGuest')
        .call<void>({'guestToken': guestToken});
  }

  /// 刪除自己的帳號。App Store 指引 5.1.1(v) 要求 App 內就能發起。
  ///
  /// 真正的刪除全在雲端函式裡（`functions/src/index.ts`）。現行規則下成員刪不掉
  /// 自己的成員文件，也改不了 `ownerId` —— 要在這裡做就得為一輩子用一次的操作
  /// 永久開兩個洞，而且跑到一半斷線會停在沒有人收拾得了的半刪除狀態。
  ///
  /// 重新驗證不是形式：這個操作不可逆，而拿到一支沒鎖的手機的人不該能刪掉別人
  /// 的帳號。改由伺服器端刪除雖然技術上不受 `user.delete()` 的 recent-login
  /// 限制，但保護的理由沒變。
  Future<void> deleteAccount() async {
    final user = _auth.currentUser;
    if (user == null) throw Exception('請先登入');

    // 訪客跳過重新驗證：他沒有任何憑證可以驗，他的「帳號」就是這台手機上的這份
    // 登入狀態。不擋的話 providerData 是空的，會落到 Google，跳出一個跟他無關的
    // 帳號選擇器。訪客的登出也走這裡（見個人頁）。
    final guest = user.isAnonymous;
    if (!guest) await _reauthenticate(user);

    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    await FirebaseFunctions.instanceFor(region: 'asia-east1')
        .httpsCallable('deleteAccount')
        .call<void>();

    // 訪客從沒碰過 GoogleSignIn，沒有東西要登出。
    if (!guest) await GoogleSignIn.instance.signOut();
    await _auth.signOut();
  }

  Future<void> _reauthenticate(User user) async {
    final providerId = user.providerData.isEmpty
        ? 'google.com'
        : user.providerData.first.providerId;

    try {
      if (providerId == 'apple.com') {
        await user.reauthenticateWithProvider(AppleAuthProvider());
      } else {
        await _ensureInitialized();
        final account = await GoogleSignIn.instance.authenticate();
        await user.reauthenticateWithCredential(
          GoogleAuthProvider.credential(idToken: account.authentication.idToken),
        );
      }
    } on GoogleSignInException catch (err) {
      if (err.code == GoogleSignInExceptionCode.canceled) {
        throw const SignInCancelled();
      }
      rethrow;
    } on FirebaseAuthException catch (err) {
      if (domain.isCancelledSignIn(err.code)) throw const SignInCancelled();
      rethrow;
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

  /// 建立個人檔案。
  ///
  /// **先讀一次，是為了不寫 createdAt。**
  ///
  /// merge 保得住沒提到的欄位，但保不住有提到的 —— 把 createdAt 放進 payload，
  /// merge 就會拿新的時間蓋掉舊的。原本的註解說「全量覆寫會把 createdAt 洗掉」，
  /// 但 merge 一樣會洗掉，寫法沒有做到註解說的那件事。
  ///
  /// 而且這條路碰得到：`main.dart` 的 gate 在**讀檔案失敗**時會顯示取暱稱頁
  /// （註解寫著「只是網路不好的話，存的時候用的是 merge，不會洗掉既有資料」——
  /// 就是這裡不成立）。也就是一次網路不順就會把註冊日洗成今天，而註冊日正是
  /// 後台用來看「這個月來了多少新人」的欄位。
  ///
  /// 從 affectedKeys 那次規則修正之後，這種寫入還會直接被擋下來（createdAt
  /// 不在 users 的 hasOnly 名單裡），使用者看到的是存不了暱稱。
  Future<void> createProfile(User user, String nickname) async {
    final ref = usersRef.doc(user.uid);
    final existing = await ref.get();

    final base = <String, dynamic>{
      'uid': user.uid,
      'nickname': nickname,
      'email': user.email ?? '',
      'photoURL': user.photoURL,
      'provider': _providerIdOfUser(user),
      'updatedAt': FieldValue.serverTimestamp(),
    };

    await ref.set(
      existing.exists
          ? base
          : {...base, 'createdAt': FieldValue.serverTimestamp()},
      SetOptions(merge: true),
    );
  }

  Future<void> updateNickname(String uid, String nickname) {
    return usersRef.doc(uid).update({
      'nickname': nickname,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// 訪客綁定帳號之後，把登入方式、email、頭像補上。暱稱不動 —— 那是使用者
  /// 自己取的。這四個欄位都在 rules 的 users update 允許清單裡。
  Future<void> updateProviderFields(User user) {
    return usersRef.doc(user.uid).update({
      'email': user.email ?? '',
      'photoURL': user.photoURL,
      'provider': _providerIdOfUser(user),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}
