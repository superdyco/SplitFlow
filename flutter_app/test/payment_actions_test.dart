import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/payment_actions.dart';
import 'package:test/test.dart';

void main() {
  Payment payment(String status) =>
      Payment(id: 'p1', from: 'alice', to: 'bob', amount: 500, status: status);

  group('canRecordPayment', () {
    test('付款人自己記', () {
      expect(
        canRecordPayment(
            canWrite: true, currentUid: 'alice', from: 'alice', isAdmin: false),
        isTrue,
      );
    });

    test('管理員可以代記 —— 被移除的成員沒辦法自己記', () {
      expect(
        canRecordPayment(
            canWrite: true, currentUid: 'carol', from: 'alice', isAdmin: true),
        isTrue,
      );
    });

    test('不相干的成員不能替別人記', () {
      expect(
        canRecordPayment(
            canWrite: true, currentUid: 'bob', from: 'alice', isAdmin: false),
        isFalse,
      );
    });

    test('封存的任務誰都不能記，管理員也一樣', () {
      expect(
        canRecordPayment(
            canWrite: false, currentUid: 'alice', from: 'alice', isAdmin: true),
        isFalse,
      );
    });
  });

  group('canConfirmPayment', () {
    test('收款人可以確認', () {
      expect(
        canConfirmPayment(
            canWrite: true,
            currentUid: 'bob',
            payment: payment('pending'),
            isAdmin: false),
        isTrue,
      );
    });

    test('付款人不能自己確認 —— 不然欠款一按就清掉了', () {
      expect(
        canConfirmPayment(
            canWrite: true,
            currentUid: 'alice',
            payment: payment('pending'),
            isAdmin: false),
        isFalse,
      );
    });

    test('已確認的不會再問一次', () {
      expect(
        canConfirmPayment(
            canWrite: true,
            currentUid: 'bob',
            payment: payment('confirmed'),
            isAdmin: true),
        isFalse,
      );
    });

    test('封存後不能確認', () {
      expect(
        canConfirmPayment(
            canWrite: false,
            currentUid: 'bob',
            payment: payment('pending'),
            isAdmin: true),
        isFalse,
      );
    });
  });

  group('canDeletePayment', () {
    test('付款人與收款人都能刪掉記錯的那筆', () {
      for (final uid in ['alice', 'bob']) {
        expect(
          canDeletePayment(
              canWrite: true,
              currentUid: uid,
              payment: payment('confirmed'),
              isAdmin: false),
          isTrue,
          reason: uid,
        );
      }
    });

    test('旁人不能刪別人之間的付款', () {
      expect(
        canDeletePayment(
            canWrite: true,
            currentUid: 'carol',
            payment: payment('pending'),
            isAdmin: false),
        isFalse,
      );
    });

    test('封存後不能刪', () {
      expect(
        canDeletePayment(
            canWrite: false,
            currentUid: 'alice',
            payment: payment('pending'),
            isAdmin: true),
        isFalse,
      );
    });
  });

  group('paymentInput', () {
    test('收款人自己記，當下就算確認', () {
      final input = paymentInput(
        from: 'alice',
        to: 'bob',
        amount: 500,
        currency: 'TWD',
        currentUid: 'bob',
      );
      expect(input['status'], 'confirmed');
    });

    test('付款人記的要等對方確認', () {
      final input = paymentInput(
        from: 'alice',
        to: 'bob',
        amount: 500,
        currency: 'TWD',
        currentUid: 'alice',
      );
      expect(input['status'], 'pending');
    });

    test('管理員代記的也是待確認 —— 他證明不了錢收到了', () {
      final input = paymentInput(
        from: 'alice',
        to: 'bob',
        amount: 500,
        currency: 'TWD',
        currentUid: 'carol',
      );
      expect(input['status'], 'pending');
    });

    test('幣別跟著寫進去，跟網頁版寫出來的文件一樣', () {
      final input = paymentInput(
        from: 'alice',
        to: 'bob',
        amount: 500,
        currency: 'JPY',
        currentUid: 'alice',
      );
      expect(input, {
        'from': 'alice',
        'to': 'bob',
        'amount': 500,
        'currency': 'JPY',
        'status': 'pending',
      });
    });
  });
}
