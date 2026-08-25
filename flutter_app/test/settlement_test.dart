import 'package:test/test.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/settlement.dart';

/// `tests/settlement.test.ts` 的 Dart 版。
///
/// 最後兩組是**不變條件**，不是個案：每種情境下 balance 加總都是 0，
/// 轉帳金額加總等於應付總額。個案會隨產品改，這兩條不會 —— 破了就是算錯錢。
void main() {
  const members = ['a', 'b', 'c'];

  Expense expense({
    String id = 'e1',
    required int amount,
    String currency = 'TWD',
    int? baseAmount,
    required String paidBy,
    required Map<String, int> splits,
  }) {
    return Expense(
      id: id,
      title: '測試支出',
      amount: amount,
      currency: currency,
      baseAmount: baseAmount ?? (currency == 'TWD' ? amount : null),
      paidBy: paidBy,
      splits: splits,
    );
  }

  /// 均分成整數，尾數丟給第一個人 —— 只是測試資料，不是產品邏輯。
  Map<String, int> even(int amount, List<String> uids) {
    final share = amount ~/ uids.length;
    final rest = amount - share * (uids.length - 1);
    return {
      for (var i = 0; i < uids.length; i += 1) uids[i]: i == 0 ? rest : share,
    };
  }

  group('baseAmountOf', () {
    test('有存換算金額就用存的', () {
      final e = expense(
        amount: 12400,
        currency: 'JPY',
        baseAmount: 261020,
        paidBy: 'a',
        splits: {'a': 12400},
      );
      expect(baseAmountOf(e, 'TWD'), 261020);
    });

    test('舊資料同幣別時沿用原金額', () {
      const e = Expense(
        id: 'e1',
        title: '舊支出',
        amount: 45000,
        currency: 'TWD',
        baseAmount: null,
        paidBy: 'a',
        splits: {'a': 45000},
      );
      expect(baseAmountOf(e, 'TWD'), 45000);
    });

    test('舊資料是外幣又沒有換算金額就算不出來', () {
      const e = Expense(
        id: 'e1',
        title: '舊外幣支出',
        amount: 12400,
        currency: 'JPY',
        baseAmount: null,
        paidBy: 'a',
        splits: {'a': 12400},
      );
      expect(baseAmountOf(e, 'TWD'), isNull);
    });
  });

  group('baseSplitsOf', () {
    test('換算後的分攤總和等於換算後的總額', () {
      final e = expense(
        amount: 10000,
        currency: 'JPY',
        baseAmount: 210500,
        paidBy: 'a',
        splits: {'a': 3334, 'b': 3333, 'c': 3333},
      );
      final splits = baseSplitsOf(e, 210500, members);
      expect(splits.values.fold<int>(0, (x, y) => x + y), 210500);
    });

    test('自訂比例換算後仍維持比例', () {
      final e = expense(
        amount: 1000,
        currency: 'JPY',
        baseAmount: 21050,
        paidBy: 'a',
        splits: {'a': 500, 'b': 500},
      );
      final splits = baseSplitsOf(e, 21050, members);
      expect(splits['a'], 10525);
      expect(splits['b'], 10525);
    });

    test('除不盡時餘數依成員順序分配，不會漏掉', () {
      final e = expense(
        amount: 100,
        paidBy: 'a',
        splits: {'a': 34, 'b': 33, 'c': 33},
      );
      final splits = baseSplitsOf(e, 100, members);
      expect(splits.values.fold<int>(0, (x, y) => x + y), 100);
      expect(splits.keys.toList(), members);
    });
  });

  group('settleExpenses', () {
    test('一個人先付、三人均分', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [],
        members,
        'TWD',
      );

      expect(result.total, 900);
      expect(result.expenseCount, 1);
      expect(result.balances.firstWhere((x) => x.uid == 'a').balance, 600);
      expect(result.transfers.length, 2);
    });

    test('兩筆互抵後只剩必要的轉帳', () {
      final result = settleExpenses(
        [
          expense(id: 'e1', amount: 900, paidBy: 'a', splits: even(900, members)),
          expense(id: 'e2', amount: 900, paidBy: 'b', splits: even(900, members)),
        ],
        [],
        members,
        'TWD',
      );

      // a 跟 b 各付各的一半，只剩 c 要還兩邊。
      expect(result.transfers.every((t) => t.from == 'c'), isTrue);
    });

    test('全部結清時沒有轉帳', () {
      final result = settleExpenses(
        [expense(amount: 300, paidBy: 'a', splits: {'a': 300})],
        [],
        members,
        'TWD',
      );
      expect(result.transfers, isEmpty);
    });

    test('缺換算金額的舊外幣支出被排除並列出來', () {
      const broken = Expense(
        id: 'bad',
        title: '沒有匯率的舊支出',
        amount: 12400,
        currency: 'JPY',
        baseAmount: null,
        paidBy: 'a',
        splits: {'a': 12400},
      );
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members)), broken],
        [],
        members,
        'TWD',
      );

      expect(result.expenseCount, 1);
      expect(result.total, 900);
      expect(result.unconverted.map((e) => e.id).toList(), ['bad']);
    });

    test('已確認的付款會把餘額扣掉', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [const Payment(from: 'b', to: 'a', amount: 300, status: 'confirmed')],
        members,
        'TWD',
      );

      expect(result.balances.firstWhere((x) => x.uid == 'b').balance, 0);
      expect(result.paidTotal, 300);
    });

    test('還沒確認的付款不影響餘額', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [const Payment(from: 'b', to: 'a', amount: 300, status: 'pending')],
        members,
        'TWD',
      );

      expect(result.balances.firstWhere((x) => x.uid == 'b').balance, -300);
      expect(result.paidTotal, 0);
    });

    test('付款不會被算進總支出', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [const Payment(from: 'b', to: 'a', amount: 300, status: 'confirmed')],
        members,
        'TWD',
      );
      expect(result.total, 900);
      expect(result.expenseCount, 1);
    });

    test('已離開的成員還在支出裡時排在成員後面', () {
      final result = settleExpenses(
        [
          expense(
            amount: 400,
            paidBy: 'a',
            splits: {'a': 100, 'b': 100, 'c': 100, 'zz-left': 100},
          )
        ],
        [],
        members,
        'TWD',
      );
      expect(result.balances.map((x) => x.uid).toList(),
          ['a', 'b', 'c', 'zz-left']);
    });
  });

  group('快照', () {
    test('暱稱一起存進快照，之後改暱稱不會改寫歷史', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [],
        members,
        'TWD',
      );
      final snapshot =
          toSnapshotInput(result, {'a': '阿明', 'b': '小美', 'c': '阿傑'}, '第一次結算');

      expect(snapshot.memberNames['a'], '阿明');
      expect(snapshot.note, '第一次結算');
    });

    test('已離開又查不到暱稱的人有備用名稱', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [],
        members,
        'TWD',
      );
      final snapshot = toSnapshotInput(result, {'a': '阿明'}, '');
      expect(snapshot.memberNames['b'], '已離開的成員');
    });

    test('帳目沒變動時比對得出一致', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [],
        members,
        'TWD',
      );
      expect(matchesSnapshot(result, toSnapshotInput(result, {}, '')), isTrue);
    });

    test('多了一筆支出就比對得出不一致', () {
      final before = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [],
        members,
        'TWD',
      );
      final snapshot = toSnapshotInput(before, {}, '');
      final after = settleExpenses(
        [
          expense(id: 'e1', amount: 900, paidBy: 'a', splits: even(900, members)),
          expense(id: 'e2', amount: 300, paidBy: 'b', splits: even(300, members)),
        ],
        [],
        members,
        'TWD',
      );
      expect(matchesSnapshot(after, snapshot), isFalse);
    });

    test('備註不影響比對結果', () {
      final result = settleExpenses(
        [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
        [],
        members,
        'TWD',
      );
      expect(
        matchesSnapshot(result, toSnapshotInput(result, {}, '完全不同的備註')),
        isTrue,
      );
    });
  });

  group('不變條件', () {
    /// 涵蓋均分、自訂、外幣、付款、多人的各種組合。
    final scenarios = <String, Settlement Function()>{
      '三人均分': () => settleExpenses(
            [expense(amount: 1000, paidBy: 'a', splits: even(1000, members))],
            [],
            members,
            'TWD',
          ),
      '除不盡': () => settleExpenses(
            [expense(amount: 1001, paidBy: 'a', splits: even(1001, members))],
            [],
            members,
            'TWD',
          ),
      '自訂分攤': () => settleExpenses(
            [
              expense(
                  amount: 1000,
                  paidBy: 'a',
                  splits: {'a': 500, 'b': 300, 'c': 200})
            ],
            [],
            members,
            'TWD',
          ),
      '外幣': () => settleExpenses(
            [
              expense(
                amount: 10000,
                currency: 'JPY',
                baseAmount: 210500,
                paidBy: 'b',
                splits: {'a': 3334, 'b': 3333, 'c': 3333},
              )
            ],
            [],
            members,
            'TWD',
          ),
      '含已確認付款': () => settleExpenses(
            [expense(amount: 900, paidBy: 'a', splits: even(900, members))],
            [const Payment(from: 'b', to: 'a', amount: 100, status: 'confirmed')],
            members,
            'TWD',
          ),
      '15 人': () {
        final many = List<String>.generate(15, (i) => 'u$i');
        return settleExpenses(
          [expense(amount: 250000, paidBy: 'u0', splits: even(250000, many))],
          [],
          many,
          'TWD',
        );
      },
    };

    scenarios.forEach((name, build) {
      test('$name：balance 加總是 0 —— 錢不會憑空出現或消失', () {
        final result = build();
        expect(result.balances.fold<int>(0, (sum, x) => sum + x.balance), 0);
      });

      test('$name：轉帳金額加總等於應付總額', () {
        final result = build();
        final owedTotal = result.balances
            .where((x) => x.balance < 0)
            .fold<int>(0, (sum, x) => sum - x.balance);
        final transferred =
            result.transfers.fold<int>(0, (sum, t) => sum + t.amount);
        expect(transferred, owedTotal);
      });
    });
  });
}
