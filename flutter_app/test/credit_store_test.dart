import 'package:test/test.dart';
import 'package:splitflow/domain/credit_store.dart';

void main() {
  group('creditPacks', () {
    test('三個方案：30／66／120 點，順序就是畫面的順序', () {
      expect(creditPacks.map((p) => p.credits).toList(), [30, 66, 120]);
      expect(
        creditPacks.map((p) => p.productId).toList(),
        ['ai_credits_30', 'ai_credits_60', 'ai_credits_100'],
      );
    });

    test('加送標籤：沒送就是空字串', () {
      expect(bonusLabel(packInfo('ai_credits_30')!), '');
      expect(bonusLabel(packInfo('ai_credits_60')!), '送 6 點');
      expect(bonusLabel(packInfo('ai_credits_100')!), '送 20 點');
    });

    test('不認得的商品 ID 回 null', () {
      expect(packInfo('ai_credits_999'), isNull);
    });
  });

  group('PurchaseResult', () {
    test('callable 回來的 Map 讀得起來', () {
      final r = PurchaseResult.fromMap(<Object?, Object?>{
        'status': 'credited',
        'credits': 66,
        'creditsLeft': 70,
      });
      expect(r.status, PurchaseResultStatus.credited);
      expect(r.credits, 66);
      expect(r.creditsLeft, 70);
    });

    test('other-account 對應 otherAccount；不認得的狀態當成 pending（不結束交易，下次再試）', () {
      expect(
        PurchaseResult.fromMap(<Object?, Object?>{'status': 'other-account'}).status,
        PurchaseResultStatus.otherAccount,
      );
      expect(
        PurchaseResult.fromMap(<Object?, Object?>{'status': '???'}).status,
        PurchaseResultStatus.pending,
      );
    });
  });

  group('shouldComplete', () {
    test('只有待處理不結束交易', () {
      expect(shouldComplete(PurchaseResultStatus.credited), true);
      expect(shouldComplete(PurchaseResultStatus.already), true);
      expect(shouldComplete(PurchaseResultStatus.otherAccount), true);
      expect(shouldComplete(PurchaseResultStatus.pending), false);
    });
  });

  group('purchaseMessage', () {
    test('四種結果的文案', () {
      expect(
        purchaseMessage(const PurchaseResult(PurchaseResultStatus.credited, 66, 70)),
        '已加 66 點，現在有 70 點',
      );
      expect(
        purchaseMessage(const PurchaseResult(PurchaseResultStatus.already, 66, 70)),
        '這筆購買之前已經加過了，現在有 70 點',
      );
      expect(
        purchaseMessage(const PurchaseResult(PurchaseResultStatus.pending, 0, null)),
        '付款處理中，完成後會自動加點',
      );
      expect(
        purchaseMessage(const PurchaseResult(PurchaseResultStatus.otherAccount, 0, null)),
        '這筆購買已經加到另一個帳號了',
      );
    });
  });
}
