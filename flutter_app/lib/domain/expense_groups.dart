import 'expense_date.dart';
import 'models.dart';
import 'settlement.dart';

/// 支出按日期分組，給列表收合用。`src/utils/expenseGroups.ts` 的 Dart 版。
///
/// 四十筆帳排成一長串很難找東西，分組之後「那筆晚餐在哪」從捲四十筆
/// 變成點一天。每組順便帶當天的小計。

class ExpenseGroup {
  /// `"YYYY-MM-DD"`。
  final String date;
  final List<Expense> expenses;
  final int count;

  /// 當天小計，主要幣別的最小單位整數。只加得出換算金額的那些。
  final int total;

  /// 當天有沒有缺匯率、沒被計進小計的支出。
  final bool hasUnconverted;

  const ExpenseGroup({
    required this.date,
    required this.expenses,
    required this.count,
    required this.total,
    required this.hasUnconverted,
  });
}

class _Building {
  final String date;
  final List<Expense> expenses = [];
  int total = 0;
  bool hasUnconverted = false;
  _Building(this.date);
}

/// 傳進來的順序就是組內的順序，不重新排 —— 列表已經用 `compareExpenses`
/// 排過（同一天後記的在前），這裡再排一次只會把那個順序弄掉。
List<ExpenseGroup> groupExpensesByDate(
  List<Expense> expenses,
  String baseCurrency,
) {
  // LinkedHashMap 保留插入順序，跟 JS 的 Map 一樣。下面還是會排序，
  // 但行為對齊比較好推理。
  final groups = <String, _Building>{};

  for (final expense in expenses) {
    final date = expenseDate(expense);
    final group = groups.putIfAbsent(date, () => _Building(date));

    group.expenses.add(expense);

    // 缺匯率的仍然列出來 —— 看得到才知道要去補。
    // 但不能算進小計，不然數字是錯的。
    final amount = baseAmountOf(expense, baseCurrency);
    if (amount == null) {
      group.hasUnconverted = true;
    } else {
      group.total += amount;
    }
  }

  return groups.values
      .map((group) => ExpenseGroup(
            date: group.date,
            expenses: group.expenses,
            count: group.expenses.length,
            total: group.total,
            hasUnconverted: group.hasUnconverted,
          ))
      .toList()
    // 日期新的在前。字串比大小就夠了，"YYYY-MM-DD" 的字典序等於時間序。
    ..sort((a, b) => b.date.compareTo(a.date));
}
