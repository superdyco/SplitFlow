import 'package:test/test.dart';
import 'package:splitflow/domain/category_totals.dart';
import 'package:splitflow/domain/expense_actions.dart';
import 'package:splitflow/domain/expense_date.dart';
import 'package:splitflow/domain/expense_groups.dart';
import 'package:splitflow/domain/models.dart';

/// `tests/expenseDate.test.ts`、`expenseGroups.test.ts`、`categoryTotals.test.ts`、
/// `repeatExpense.test.ts`、`memberRemoval.test.ts` 的 Dart 版。
void main() {
  Expense expense({
    String id = 'e1',
    String title = '測試支出',
    int amount = 1000,
    String currency = 'TWD',
    int? baseAmount,
    String paidBy = 'a',
    Map<String, int>? splits,
    ExpenseCategory category = ExpenseCategory.food,
    SplitMode splitMode = SplitMode.even,
    String? date,
    String? time,
    DateTime? createdAt,
    ExpensePlace? place,
  }) {
    return Expense(
      id: id,
      title: title,
      amount: amount,
      currency: currency,
      baseAmount: baseAmount ?? (currency == 'TWD' ? amount : null),
      paidBy: paidBy,
      splits: splits ?? {'a': amount},
      category: category,
      splitMode: splitMode,
      date: date,
      time: time,
      createdAt: createdAt,
      place: place,
    );
  }

  group('toDateInput / toTimeInput', () {
    test('用本地時區，不是 UTC —— 凌晨記的帳不能算成前一天', () {
      // 本地時間 2026-06-15 00:30。轉成 UTC 會變成前一天（台灣是 +8）。
      final at = DateTime(2026, 6, 15, 0, 30);
      expect(toDateInput(at), '2026-06-15');
      expect(toTimeInput(at), '00:30');
    });

    test('個位數補零', () {
      final at = DateTime(2026, 1, 2, 3, 4);
      expect(toDateInput(at), '2026-01-02');
      expect(toTimeInput(at), '03:04');
    });
  });

  group('expenseDate / expenseTime', () {
    test('有 date 就用 date', () {
      expect(expenseDate(expense(date: '2026-06-15')), '2026-06-15');
    });

    test('舊資料沒有 date 時退回 createdAt 的日期', () {
      final e = expense(date: null, createdAt: DateTime(2026, 6, 15, 10, 0));
      expect(expenseDate(e), '2026-06-15');
    });

    test('date 跟 createdAt 都沒有就是空字串，不會爆', () {
      expect(expenseDate(expense(date: null, createdAt: null)), '');
    });

    test('沒記時間就是空字串 —— 不拿 createdAt 硬湊一個出來', () {
      // 補記昨天晚餐的人是今天下午按的送出，拿 createdAt 當時間就是憑空捏造。
      final e = expense(date: '2026-06-14', time: null, createdAt: DateTime(2026, 6, 15, 16, 0));
      expect(expenseTime(e), '');
    });
  });

  group('compareExpenses', () {
    test('日期新的在前', () {
      final older = expense(id: 'old', date: '2026-06-14');
      final newer = expense(id: 'new', date: '2026-06-15');
      final list = [older, newer]..sort(compareExpenses);
      expect(list.map((e) => e.id).toList(), ['new', 'old']);
    });

    test('同一天，晚的時間在前', () {
      final morning = expense(id: 'am', date: '2026-06-15', time: '08:00');
      final evening = expense(id: 'pm', date: '2026-06-15', time: '19:30');
      final list = [morning, evening]..sort(compareExpenses);
      expect(list.map((e) => e.id).toList(), ['pm', 'am']);
    });

    test('沒記時間的沉到當天最後', () {
      final timed = expense(id: 'timed', date: '2026-06-15', time: '08:00');
      final untimed = expense(id: 'untimed', date: '2026-06-15', time: null);
      final list = [untimed, timed]..sort(compareExpenses);
      expect(list.map((e) => e.id).toList(), ['timed', 'untimed']);
    });

    test('剛送出、createdAt 還沒回來的排在當天最上面', () {
      final saved = expense(
          id: 'saved', date: '2026-06-15', createdAt: DateTime(2026, 6, 15, 10, 0));
      final pending = expense(id: 'pending', date: '2026-06-15', createdAt: null);
      final list = [saved, pending]..sort(compareExpenses);
      expect(list.map((e) => e.id).toList(), ['pending', 'saved']);
    });
  });

  group('groupExpensesByDate', () {
    test('同一天併成一組，日期新的在前', () {
      final groups = groupExpensesByDate([
        expense(id: 'e1', date: '2026-06-14', amount: 100),
        expense(id: 'e2', date: '2026-06-15', amount: 200),
        expense(id: 'e3', date: '2026-06-14', amount: 300),
      ], 'TWD');

      expect(groups.map((g) => g.date).toList(), ['2026-06-15', '2026-06-14']);
      expect(groups[1].count, 2);
      expect(groups[1].total, 400);
    });

    test('組內維持傳進來的順序，不重新排', () {
      final groups = groupExpensesByDate([
        expense(id: 'first', date: '2026-06-15'),
        expense(id: 'second', date: '2026-06-15'),
      ], 'TWD');
      expect(groups.first.expenses.map((e) => e.id).toList(), ['first', 'second']);
    });

    test('缺換算金額的照樣列出來，但不算進小計', () {
      final groups = groupExpensesByDate([
        expense(id: 'ok', date: '2026-06-15', amount: 500),
        expense(
          id: 'bad',
          date: '2026-06-15',
          amount: 12400,
          currency: 'JPY',
          baseAmount: null,
        ),
      ], 'TWD');

      expect(groups.first.count, 2);
      expect(groups.first.total, 500);
      expect(groups.first.hasUnconverted, isTrue);
    });

    test('空清單回空清單', () {
      expect(groupExpensesByDate([], 'TWD'), isEmpty);
    });
  });

  group('categoryTotals', () {
    test('同分類加總，金額大的在前，佔比加起來是 100', () {
      final totals = categoryTotals([
        expense(id: 'e1', amount: 300, category: ExpenseCategory.food),
        expense(id: 'e2', amount: 700, category: ExpenseCategory.stay),
        expense(id: 'e3', amount: 200, category: ExpenseCategory.food),
      ], 'TWD');

      expect(totals.first.category, ExpenseCategory.stay);
      expect(totals.first.total, 700);
      expect(totals[1].total, 500);
      expect(totals.fold<double>(0, (a, t) => a + t.share), closeTo(100, 0.0001));
    });

    test('缺換算金額的被排除 —— 要跟結算用同一套規則', () {
      final totals = categoryTotals([
        expense(id: 'ok', amount: 1000, category: ExpenseCategory.food),
        expense(
          id: 'bad',
          amount: 12400,
          currency: 'JPY',
          baseAmount: null,
          category: ExpenseCategory.transport,
        ),
      ], 'TWD');

      expect(totals.length, 1);
      expect(totals.first.category, ExpenseCategory.food);
    });

    test('金額相同時照分類的固定順序，結果不隨輸入順序跳動', () {
      final first = categoryTotals([
        expense(id: 'e1', amount: 500, category: ExpenseCategory.shopping),
        expense(id: 'e2', amount: 500, category: ExpenseCategory.food),
      ], 'TWD');
      final second = categoryTotals([
        expense(id: 'e2', amount: 500, category: ExpenseCategory.food),
        expense(id: 'e1', amount: 500, category: ExpenseCategory.shopping),
      ], 'TWD');

      // food 在 expenseCategories 裡排在 shopping 前面。
      expect(first.map((t) => t.category).toList(),
          [ExpenseCategory.food, ExpenseCategory.shopping]);
      expect(second.map((t) => t.category).toList(),
          first.map((t) => t.category).toList());
    });

    test('沒有支出時回空清單，不會除以 0', () {
      expect(categoryTotals([], 'TWD'), isEmpty);
    });
  });

  group('categoryFrom', () {
    test('認得的字串轉成對應分類', () {
      expect(categoryFrom('food'), ExpenseCategory.food);
      expect(categoryFrom('transport'), ExpenseCategory.transport);
    });

    test('認不得的一律歸其他 —— 不能讓支出因為分類是新的就消失', () {
      expect(categoryFrom('沒看過的分類'), ExpenseCategory.other);
      expect(categoryFrom(null), ExpenseCategory.other);
    });
  });

  group('repeatFieldsOf', () {
    test('帶走會重複的欄位', () {
      final source = expense(
        title: '便利商店',
        currency: 'JPY',
        baseAmount: 1000,
        paidBy: 'b',
        splits: {'a': 500, 'b': 500},
        category: ExpenseCategory.food,
        splitMode: SplitMode.custom,
        place: const ExpensePlace(name: '7-11'),
      );
      final fields = repeatFieldsOf(source);

      expect(fields.title, '便利商店');
      expect(fields.currency, 'JPY');
      expect(fields.paidBy, 'b');
      expect(fields.splitMode, SplitMode.custom);
      expect(fields.splits, {'a': 500, 'b': 500});
      expect(fields.place?.name, '7-11');
    });

    test('splits 是複本，改新的一筆不會動到來源', () {
      final source = expense(splits: {'a': 500, 'b': 500});
      final fields = repeatFieldsOf(source);
      fields.splits['a'] = 999;
      expect(source.splits['a'], 500);
    });

    test('沒有地點時是 null，不會爆', () {
      expect(repeatFieldsOf(expense(place: null)).place, isNull);
    });
  });

  group('removeMemberMessage', () {
    test('結清的人訊息最短 —— 沒有後果要警告', () {
      final message = removeMemberMessage(name: '阿明', balance: 0, currency: 'TWD');
      expect(message, contains('阿明'));
      expect(message, isNot(contains('沒付')));
    });

    test('他還沒付的時候要講「只能由管理員代記」', () {
      final message =
          removeMemberMessage(name: '阿明', balance: -50000, currency: 'TWD');
      expect(message, contains('阿明 還有 TWD 500.00 沒付'));
      expect(message, contains('管理員代記'));
    });

    test('別人欠他的時候要講「查不到誰還沒付他錢」', () {
      final message =
          removeMemberMessage(name: '小美', balance: 50000, currency: 'TWD');
      expect(message, contains('還有 TWD 500.00 要付給 小美'));
      expect(message, contains('查不到誰還沒付他錢'));
    });

    test('沒有暱稱時有備用稱呼，不會出現空白', () {
      final message = removeMemberMessage(name: '', balance: 0, currency: 'TWD');
      expect(message, contains('這位成員'));
    });
  });
}
