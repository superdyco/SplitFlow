/// App 層級的購買監聽。
///
/// **為什麼在 `main.dart` 啟動，不是在儲值頁**：付款完成、伺服器還沒回覆就斷線
/// 或關掉 App 的話，商店會在下次啟動時把那筆交易再送一次。只在儲值頁聽的話，
/// 使用者不打開那一頁，那筆錢就永遠補不到點。
///
/// provider 定義在這裡而不是 `providers.dart`：這支要讀 `providers.dart` 裡的
/// repository 與點數，反過來也 import 的話兩個檔案會互相依賴。
library;

import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../data/error_text.dart';
import '../domain/credit_store.dart';
import '../domain/debug_log.dart';
import 'providers.dart';

/// 儲值頁顯示的那一行。null 是沒有要說的事。
class PurchaseNotice {
  final String message;
  final bool error;
  const PurchaseNotice(this.message, {this.error = false});
}

final purchaseNoticeProvider = StateProvider<PurchaseNotice?>((ref) => null);

/// `main.dart` 在 Firebase 初始化之後啟動它。
final purchaseListenerProvider = Provider((ref) => PurchaseListener(ref));

class PurchaseListener {
  final Ref _ref;
  StreamSubscription<List<PurchaseDetails>>? _subscription;

  PurchaseListener(this._ref);

  void start() {
    _subscription ??= _ref.read(creditPurchaseRepositoryProvider).updates.listen(
          (list) async {
            for (final details in list) {
              await _handle(details);
            }
          },
          onError: (Object err) => logError('purchase-stream', err),
        );
  }

  void _say(PurchaseNotice? notice) => _ref.read(purchaseNoticeProvider.notifier).state = notice;

  Future<void> _handle(PurchaseDetails details) async {
    switch (details.status) {
      case PurchaseStatus.pending:
        _say(const PurchaseNotice('付款處理中，完成後會自動加點'));
        return;
      case PurchaseStatus.canceled:
        // 使用者自己取消，不是錯誤。清掉上一則，讓儲值頁的按鈕回到可按。
        _say(null);
        return;
      case PurchaseStatus.error:
        _say(PurchaseNotice(errorText(details.error), error: true));
        return;
      case PurchaseStatus.purchased:
      case PurchaseStatus.restored:
        // 消耗型商品理論上不會有 restored，但 StoreKit 2 有回報過；伺服器是冪等的，照買到處理。
        break;
    }

    // 啟動時登入狀態是非同步還原的，currentUser 可能還是 null —— 等第一個狀態出來。
    final user = await FirebaseAuth.instance.authStateChanges().first;
    if (user == null || user.isAnonymous) {
      // 不結束交易：登入正式帳號之後重開 App，商店會再送一次。
      _say(const PurchaseNotice('登入正式帳號之後會自動加點', error: true));
      return;
    }

    final repository = _ref.read(creditPurchaseRepositoryProvider);
    try {
      final result = await repository.verify(details);
      if (shouldComplete(result.status)) await repository.complete(details);
      _ref.invalidate(aiCreditsProvider);
      _say(PurchaseNotice(
        purchaseMessage(result),
        error: result.status == PurchaseResultStatus.otherAccount,
      ));
    } catch (err) {
      // 不結束交易：下次開 App 商店會重送，伺服器是冪等的。
      logError('purchase-verify', err);
      _say(PurchaseNotice(
        '付款成功了，但點數還沒加上（${errorText(err)}）。重新打開 App 會自動再試一次。',
        error: true,
      ));
    }
  }
}
