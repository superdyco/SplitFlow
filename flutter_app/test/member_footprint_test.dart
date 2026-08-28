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
    test('沒有帳時不給選擇，也不要求打字', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 0,
          paymentCount: 0,
          balance: 0,
          currency: 'TWD');
      expect(prompt.hasRecords, isFalse);
      expect(prompt.requireText, isNull);
      expect(prompt.message, contains('還沒有任何支出與付款記錄'));
    });

    test('有帳時要求打出名字才能真刪', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 12,
          paymentCount: 2,
          balance: 0,
          currency: 'TWD');
      expect(prompt.hasRecords, isTrue);
      expect(prompt.requireText, '阿嬤');
      expect(prompt.message, contains('12 筆支出'));
      expect(prompt.message, contains('2 筆付款記錄'));
    });

    test('風險揭露那兩句不能少', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤',
          expenseCount: 12,
          paymentCount: 0,
          balance: 0,
          currency: 'TWD');
      expect(prompt.message, contains('別人付的'));
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
  });
}
