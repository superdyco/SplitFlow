import 'models.dart';
import 'settlement.dart';

/// 各分類的支出金額與佔比。`src/utils/categoryTotals.ts` 的 Dart 版。
///
/// 用 `baseAmountOf` 取換算後的金額，跟 `settleExpenses` 是同一套規則 ——
/// 缺匯率的支出兩邊都排除。不一致的話圖表的總和會跟結算的總額對不起來，
/// 那比沒有圖表更糟。

class CategoryTotal {
  final ExpenseCategory category;

  /// 主要幣別的最小單位整數。
  final int total;

  /// 佔列入金額的百分比，0-100。
  final double share;

  const CategoryTotal({
    required this.category,
    required this.total,
    required this.share,
  });
}

/// 金額相同時的次要排序依據，讓結果不會因為輸入順序而跳動。
int _categoryOrder(ExpenseCategory category) =>
    expenseCategories.indexWhere((meta) => meta.value == category);

List<CategoryTotal> categoryTotals(List<Expense> expenses, String baseCurrency) {
  final totals = <ExpenseCategory, int>{};
  var sum = 0;

  for (final expense in expenses) {
    final amount = baseAmountOf(expense, baseCurrency);
    if (amount == null) continue;
    totals[expense.category] = (totals[expense.category] ?? 0) + amount;
    sum += amount;
  }

  return totals.entries
      .map((entry) => CategoryTotal(
            category: entry.key,
            total: entry.value,
            share: sum > 0 ? (entry.value / sum) * 100 : 0,
          ))
      .toList()
    ..sort((a, b) {
      final byTotal = b.total.compareTo(a.total);
      // 金額相同時比分類的固定順序 —— Dart 的 sort 不保證穩定，
      // 少了這個結果會隨輸入順序跳動。
      return byTotal != 0
          ? byTotal
          : _categoryOrder(a.category).compareTo(_categoryOrder(b.category));
    });
}
