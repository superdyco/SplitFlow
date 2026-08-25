import 'package:test/test.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/my_cost.dart';
import 'package:splitflow/domain/settlement.dart';

/// `tests/myCost.test.ts` 的 Dart 版。
void main() {
  const members = ['a', 'b', 'c'];

  Expense expense({
    String id = 'e1',
    required int amount,
    required String paidBy,
    required Map<String, int> splits,
  }) {
    return Expense(
      id: id,
      title: '測試支出',
      amount: amount,
      currency: 'TWD',
      baseAmount: amount,
      paidBy: paidBy,
      splits: splits,
    );
  }

  group('myTripCost', () {
    test('算的是我該分攤的，不是我先付出去的', () {
      // a 先付 900，三人各分 300。a 的「花費」是 300，不是 900。
      final expenses = [
        expense(amount: 900, paidBy: 'a', splits: {'a': 300, 'b': 300, 'c': 300})
      ];
      expect(myTripCost(expenses, members, 'a', 'TWD'), 300);
      expect(myTripCost(expenses, members, 'b', 'TWD'), 300);
    });

    test('沒參與分攤的人是 0', () {
      final expenses = [
        expense(amount: 600, paidBy: 'a', splits: {'a': 300, 'b': 300})
      ];
      expect(myTripCost(expenses, members, 'c', 'TWD'), 0);
    });

    test('完全不在名單上的人也是 0，不會爆', () {
      final expenses = [expense(amount: 300, paidBy: 'a', splits: {'a': 300})];
      expect(myTripCost(expenses, members, '不存在的人', 'TWD'), 0);
    });

    test('沒有支出時是 0', () {
      expect(myTripCost([], members, 'a', 'TWD'), 0);
    });

    test('跟結算頁算出來的分攤金額完全一致 —— 差一分錢就是 bug', () {
      // 除不盡的情境最容易兩邊對不上。
      final expenses = [
        expense(amount: 1000, paidBy: 'a', splits: {'a': 334, 'b': 333, 'c': 333})
      ];
      final settlement = settleExpenses(expenses, const [], members, 'TWD');

      for (final uid in members) {
        final fromSettlement =
            settlement.balances.firstWhere((x) => x.uid == uid).owed;
        expect(myTripCost(expenses, members, uid, 'TWD'), fromSettlement);
      }
    });
  });

  group('sumByCurrency', () {
    test('同幣別加總，不同幣別分開列', () {
      final result = sumByCurrency(const [
        CurrencyAmount('TWD', 1000),
        CurrencyAmount('JPY', 5000),
        CurrencyAmount('TWD', 500),
      ]);

      expect(result, const [CurrencyAmount('JPY', 5000), CurrencyAmount('TWD', 1500)]);
    });

    test('金額大的排前面', () {
      final result = sumByCurrency(const [
        CurrencyAmount('TWD', 100),
        CurrencyAmount('JPY', 900),
      ]);
      expect(result.first.currency, 'JPY');
    });

    test('平手時比幣別代碼 —— 順序要是確定的', () {
      final result = sumByCurrency(const [
        CurrencyAmount('TWD', 500),
        CurrencyAmount('JPY', 500),
      ]);
      expect(result.map((x) => x.currency).toList(), ['JPY', 'TWD']);
    });

    test('0 的幣別不列出來', () {
      final result = sumByCurrency(const [
        CurrencyAmount('TWD', 1000),
        CurrencyAmount('JPY', 0),
      ]);
      expect(result.length, 1);
      expect(result.first.currency, 'TWD');
    });

    test('空清單回空清單', () {
      expect(sumByCurrency(const []), isEmpty);
    });
  });
}
