/// Firestore 寫入的離線處理。`src/utils/offlineWrite.ts` 的 Dart 版。
///
/// 這支原本被歸類成「原生要重寫」，實際查過之後發現不用：**FlutterFire 的
/// 寫入 Future 跟 JS SDK 一樣，要等伺服器確認才完成**，離線時永遠不會回來 ——
/// 但資料其實已經安全寫進本機佇列、連上網就會自動送出。
///
/// 直接 await 的話畫面會卡死在「儲存中...」，使用者以為壞了然後重複按。
/// 所以這裡等一小段時間就好：有回應就是 synced，沒回應當作 queued 讓使用者
/// 往下走。
///
/// 純函式，不 import Firebase 也不 import Flutter。
library;

import 'dart:async';

enum WriteOutcome {
  /// 伺服器確認了。
  synced,

  /// 還沒確認，但已經進了本機佇列，連上網會自己送出。
  queued,
}

/// 逾時之後才發生的失敗會被這裡吞掉，使用者看不到錯誤訊息。
///
/// 這是有意的取捨：那個情境幾乎只會是規則違反，而規則違反在送出前的表單
/// 驗證就該擋下來了；為了它把所有離線寫入都卡住並不划算。
Future<WriteOutcome> settleWrite(
  Future<void> write, {
  Duration timeout = const Duration(milliseconds: 2500),
}) {
  final completer = Completer<WriteOutcome>();

  final timer = Timer(timeout, () {
    if (!completer.isCompleted) completer.complete(WriteOutcome.queued);
  });

  write.then(
    (_) {
      timer.cancel();
      if (!completer.isCompleted) completer.complete(WriteOutcome.synced);
    },
    onError: (Object error, StackTrace stack) {
      timer.cancel();
      // 逾時後才走到這裡的話 completer 已經完成，這個分支是 no-op ——
      // 但錯誤有被接住，不會變成未處理的例外。
      if (!completer.isCompleted) completer.completeError(error, stack);
    },
  );

  return completer.future;
}
