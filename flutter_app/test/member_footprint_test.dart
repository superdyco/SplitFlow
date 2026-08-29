import 'package:test/test.dart';
import 'package:splitflow/domain/member_footprint.dart';
import 'package:splitflow/domain/models.dart';

/// `tests/memberFootprint.test.ts` 的 Dart 版。兩邊要對同一份資料給出
/// 同樣的筆數 —— 不然使用者在 App 上看到 12 筆、在網頁上看到 11 筆。
Expense _expense(String id, String paidBy, Map<String, int> splits) => Expense(
      id: id,
      title: '晚餐',
      amount: 1000,
      currency: 'TWD',
      baseAmount: 1000,
      paidBy: paidBy,
      splits: splits,
      category: ExpenseCategory.food,
      splitMode: SplitMode.even,
      date: '2026-08-28',
    );

Payment _payment(String id, String from, String to, String status) =>
    Payment(id: id, from: from, to: to, amount: 500, status: status);

void main() {
  group('memberFootprint', () {
    test('認得他是付款人的支出', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'amma', {'ming': 1000})], []);
      expect(result.expenseIds, ['e1']);
    });

    test('認得他被分攤的支出 —— 就算是別人付的', () {
      final result = memberFootprint(
          'amma', [_expense('e1', 'ming', {'ming': 500, 'amma': 500})], []);
      expect(result.expenseIds, ['e1']);
    });

    // 自訂分攤可以給某個人 0 元，那也算參與。
    test('分攤金額 0 也算', () {
      final result = memberFootprint(
          'amma', [_expense('e1', 'ming', {'ming': 1000, 'amma': 0})], []);
      expect(result.expenseIds, ['e1']);
    });

    test('既是付款人又在分攤裡，只算一次', () {
      final result = memberFootprint(
          'amma', [_expense('e1', 'amma', {'amma': 500, 'ming': 500})], []);
      expect(result.expenseIds, ['e1']);
    });

    test('跟他無關的支出不算', () {
      final result = memberFootprint(
          'amma', [_expense('e1', 'ming', {'ming': 500, 'hua': 500})], []);
      expect(result.expenseIds, isEmpty);
    });

    test('認得付款的兩端，pending 與 confirmed 都算', () {
      final result = memberFootprint('amma', [], [
        _payment('p1', 'amma', 'ming', 'pending'),
        _payment('p2', 'ming', 'amma', 'confirmed'),
        _payment('p3', 'ming', 'hua', 'confirmed'),
      ]);
      expect(result.paymentIds, ['p1', 'p2']);
    });

    test('完全沒帳時 hasRecords 是 false', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'ming', {'ming': 1000})], []);
      expect(result.hasRecords, isFalse);
    });
  });

  group('removeMemberPrompt', () {
    test('沒有帳時不給選擇', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 0,
          paymentCount: 0,
          balance: 0,
          currency: 'TWD');
      expect(prompt.hasRecords, isFalse);
      expect(prompt.message, contains('還沒有任何支出與付款記錄'));
    });

    test('有帳時要給兩個選擇，並把筆數數出來', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 12,
          paymentCount: 2,
          balance: 0,
          currency: 'TWD');
      expect(prompt.hasRecords, isTrue);
      expect(prompt.message, contains('12 筆支出'));
      expect(prompt.message, contains('2 筆付款記錄'));
    });

    test('講明結算紀錄裡他還在', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 12,
          paymentCount: 0,
          balance: 0,
          currency: 'TWD');
      expect(prompt.message, contains('結算紀錄'));
    });

    test('只有付款沒有支出時不會冒出「0 筆支出」', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 0,
          paymentCount: 3,
          balance: 0,
          currency: 'TWD');
      expect(prompt.message, contains('3 筆付款記錄'));
      expect(prompt.message, isNot(contains('0 筆支出')));
    });

    test('沒有名字時用代稱', () {
      final prompt = removeMemberPrompt(
          name: '',
          expenseCount: 0,
          paymentCount: 0,
          balance: 0,
          currency: 'TWD');
      expect(prompt.title, contains('這位成員'));
    });

    RemoveMemberPrompt withRecords({
      int? balance = 0,
      bool virtual = false,
      bool othersPaid = false,
      String currency = 'TWD',
    }) =>
        removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 3,
          paymentCount: 0,
          balance: balance,
          currency: currency,
          virtual: virtual,
          othersPaid: othersPaid,
        );

    // 選項說明是陳述句。這裡曾經直接嵌入一份獨立的確認訊息，變成在選項裡
    // 再問一次，而且餘額不是 0 時會在兩個項目符號之間插進空行與懸空的問句。
    group('兩個選項的說明', () {
      test('不是問句', () {
        final message = withRecords(balance: -80000).message;
        expect(message, isNot(contains('嗎？')));
        expect(message, isNot(contains('確定要移除')));
      });

      test('兩個項目符號之間只有一個空行', () {
        final message = withRecords(balance: -80000).message;
        final between = message
            .split('・保留結算資料：')[1]
            .split('・真實移除：')[0];
        expect(between, isNot(contains('\n\n\n')));
        expect(between.trimRight().split('\n').length, 1);
      });
    });

    group('餘額', () {
      test('他還沒付時講出金額', () {
        expect(withRecords(balance: -80000).message,
            contains('他還有 TWD 800.00 沒付'));
      });

      test('還有人要付給他時是另一句', () {
        expect(withRecords(balance: 125000).message,
            contains('還有 TWD 1,250.00 要付給他'));
      });

      test('金額走 formatAmount，零小數幣別不會多出小數點', () {
        expect(withRecords(balance: -125000, currency: 'KRW').message,
            contains('KRW 125,000 沒付'));
      });

      test('已結清時不提金額', () {
        final message = withRecords(balance: 0).message;
        expect(message, isNot(contains('沒付')));
        expect(message, isNot(contains('要付給')));
      });

      // 這一條是這次修的核心：算不出來跟已結清是兩回事，混為一談就是在
      // 一個不可逆的決定前面謊報「他沒有欠款」。
      test('算不出來時照實說，不能講得像已結清', () {
        expect(withRecords(balance: null).message, contains('算不出他的結算餘額'));
      });
    });

    group('虛擬成員', () {
      test('不講「看不到這個任務」—— 他從來就沒有帳號', () {
        expect(withRecords(virtual: true).message,
            isNot(contains('看不到這個任務')));
      });

      test('真實成員照講', () {
        expect(withRecords().message, contains('他之後看不到這個任務'));
      });
    });

    group('會不會誤傷別人的帳', () {
      // 這句是整個功能的風險揭露，該出現的時候少一句都不行。
      test('有別人付的支出時要警告', () {
        expect(withRecords(othersPaid: true).message, contains('別人付的'));
      });

      test('全部都是他自己付的就不要嚇人', () {
        expect(withRecords(othersPaid: false).message,
            isNot(contains('別人付的')));
      });
    });
  });

  group('othersPaid', () {
    test('有別人付、他只是被分攤的支出 → true', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'ming', {'amma': 1000})], []);
      expect(result.othersPaid, isTrue);
    });

    test('全部都是他自己付的 → false', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'amma', {'amma': 1000})], []);
      expect(result.othersPaid, isFalse);
    });

    test('混在一起時仍然是 true —— 只要有一筆會連累別人就要講', () {
      final result = memberFootprint(
        'amma',
        [
          _expense('e1', 'amma', {'amma': 1000}),
          _expense('e2', 'ming', {'amma': 500}),
        ],
        [],
      );
      expect(result.othersPaid, isTrue);
    });

    test('完全沒帳時是 false', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'ming', {'ming': 1000})], []);
      expect(result.othersPaid, isFalse);
    });
  });
}
