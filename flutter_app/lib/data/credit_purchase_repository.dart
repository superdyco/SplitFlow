/// 儲值。付款交給 `in_app_purchase`，**加點交給伺服器**（`purchaseCredits`）。
library;

import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../domain/credit_store.dart';
import '../domain/debug_log.dart';

class CreditPurchaseRepository {
  final InAppPurchase _iap = InAppPurchase.instance;

  /// 商店重送的交易也從這裡來 —— 所以要在 App 一啟動就聽（見 PurchaseListener）。
  Stream<List<PurchaseDetails>> get updates => _iap.purchaseStream;

  Future<bool> available() => _iap.isAvailable();

  /// 照 `creditPacks` 的順序排。商店查不到的方案不顯示 —— 不畫假價格。
  Future<List<ProductDetails>> products() async {
    final response = await _iap.queryProductDetails({for (final p in creditPacks) p.productId});
    final byId = {for (final p in response.productDetails) p.id: p};
    return [
      for (final pack in creditPacks)
        if (byId[pack.productId] != null) byId[pack.productId]!,
    ];
  }

  Future<bool> buy(ProductDetails product) => _iap.buyConsumable(
        purchaseParam: PurchaseParam(productDetails: product),
        // iOS 的外掛規定一定要 true（原始碼裡有 assert），而 iOS 的「消耗」就是
        // completePurchase —— 我們等伺服器加完點才呼叫它。Android 不讓外掛自己
        // 消耗，由伺服器驗證加點之後消耗。
        autoConsume: Platform.isIOS,
      );

  Future<PurchaseResult> verify(PurchaseDetails details) async {
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    final call = FirebaseFunctions.instanceFor(region: 'asia-east1').httpsCallable('purchaseCredits');
    final result = await call.call<Map<Object?, Object?>>({
      'platform': Platform.isIOS ? 'ios' : 'android',
      'productId': details.productID,
      // iOS 是交易 ID，Android 是 orderId。
      'purchaseId': details.purchaseID,
      // iOS 是簽章過的交易（JWS），Android 是 purchaseToken。
      'verificationData': details.verificationData.serverVerificationData,
    });
    return PurchaseResult.fromMap(result.data);
  }

  /// 結束交易。**只在伺服器回覆之後呼叫。**
  ///
  /// Android 的伺服器消耗已經包含確認，這裡再確認一次可能被 Google 回「商品不存在」
  /// —— 那不影響已經加的點數，記一筆就好。iOS 的失敗照常往外丟：那代表交易沒結束。
  Future<void> complete(PurchaseDetails details) async {
    if (!details.pendingCompletePurchase) return;
    try {
      await _iap.completePurchase(details);
    } catch (err) {
      if (Platform.isIOS) rethrow;
      logError('purchase-complete', err);
    }
  }
}
