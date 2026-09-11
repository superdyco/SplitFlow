import 'package:firebase_core/firebase_core.dart';

import '../domain/debug_log.dart';
import '../domain/error_message.dart';

/// 畫面上要顯示的錯誤訊息。網頁版 `firebaseErrorMessage` 的 Dart 版。
///
/// 在這之前，畫面上的錯誤一律是 `err.toString()`：Firestore 的錯誤會照英文
/// 原文出現（「[cloud_firestore/permission-denied] The caller does not have
/// permission…」），自己丟的 `Exception('中文說明')` 前面還會多一段
/// 「Exception: 」。
///
/// 放在 data 層而不是 domain：要認得 `FirebaseException` 就得 import Firebase，
/// 而 domain 不能。真正的對照規則在 `domain/error_message.dart`，那裡測得到。
///
/// 順手把原文留進錯誤清單 —— 跟網頁版同一個理由：這是唯一收得齊的位置，
/// 而且使用者看到的那句話與診斷資訊裡的那一筆一定對得起來。
String errorText(Object? error) {
  logError('firebase', error);
  if (error is FirebaseException) {
    return friendlyError(code: error.code, message: error.message);
  }
  if (error is FormatException) return error.message;
  // `StateError('中文說明').toString()` 前面會多一段「Bad state: 」，
  // 建立任務那一頁就是這樣丟「找不到個人資料」的。
  if (error is StateError) return error.message;
  return withoutExceptionPrefix(describeError(error));
}
