/// 儲值頁的顯示資料與購買結果的文案。純 Dart，不 import 外掛。
///
/// **點數對照的正本在 `functions/src/purchase/products.ts`。** 這一份只拿來畫
/// 儲值頁 —— 伺服器不看它，App 說買了幾點都不算數。兩邊對不上的症狀是
/// 「頁面寫 66 點，實際加了 60 點」，所以改一邊要改另一邊。
library;

class CreditPackInfo {
  final String productId;
  final int credits;
  final int bonus;
  const CreditPackInfo(this.productId, this.credits, this.bonus);
}

const creditPacks = [
  CreditPackInfo('ai_credits_30', 30, 0),
  CreditPackInfo('ai_credits_60', 66, 6),
  CreditPackInfo('ai_credits_100', 120, 20),
];

CreditPackInfo? packInfo(String productId) {
  for (final pack in creditPacks) {
    if (pack.productId == productId) return pack;
  }
  return null;
}

String bonusLabel(CreditPackInfo pack) => pack.bonus > 0 ? '送 ${pack.bonus} 點' : '';

enum PurchaseResultStatus { credited, already, pending, otherAccount }

class PurchaseResult {
  final PurchaseResultStatus status;
  final int credits;
  final int? creditsLeft;
  const PurchaseResult(this.status, this.credits, this.creditsLeft);

  factory PurchaseResult.fromMap(Map<dynamic, dynamic> map) {
    final status = switch (map['status']) {
      'credited' => PurchaseResultStatus.credited,
      'already' => PurchaseResultStatus.already,
      'other-account' => PurchaseResultStatus.otherAccount,
      // 不認得的當成待處理：不結束交易，商店下次會重送，比吞掉一筆付款安全。
      _ => PurchaseResultStatus.pending,
    };
    return PurchaseResult(
      status,
      (map['credits'] as num?)?.toInt() ?? 0,
      (map['creditsLeft'] as num?)?.toInt(),
    );
  }
}

/// 待處理以外都要結束交易。
///
/// 另一個帳號（otherAccount）也要結束：不結束的話那筆交易會永遠重送，
/// iOS 上同一個商品再也買不了。
bool shouldComplete(PurchaseResultStatus status) => status != PurchaseResultStatus.pending;

String purchaseMessage(PurchaseResult result) => switch (result.status) {
      PurchaseResultStatus.credited => '已加 ${result.credits} 點，現在有 ${result.creditsLeft} 點',
      PurchaseResultStatus.already => '這筆購買之前已經加過了，現在有 ${result.creditsLeft} 點',
      PurchaseResultStatus.pending => '付款處理中，完成後會自動加點',
      PurchaseResultStatus.otherAccount => '這筆購買已經加到另一個帳號了',
    };
