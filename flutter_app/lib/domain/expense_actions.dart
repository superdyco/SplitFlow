import 'models.dart';

/// 「再記一筆」要帶走什麼。
/// `src/utils/repeatExpense.ts` 的 Dart 版。

/// 「再記一筆」要帶走的欄位。
class RepeatFields {
  final String title;
  final ExpenseCategory category;
  final String currency;
  final String paidBy;
  final SplitMode splitMode;
  final Map<String, int> splits;
  final ExpensePlace? place;

  const RepeatFields({
    required this.title,
    required this.category,
    required this.currency,
    required this.paidBy,
    required this.splitMode,
    required this.splits,
    required this.place,
  });
}

/// 旅行支出重複性很高（每天的交通、便利商店、同一間餐廳），每次從頭填很煩。
///
/// 刻意不帶的三樣：
/// - `amount`：那正是每次要改的東西
/// - `date` / `time`：再記一筆是記現在的，不是原本那天那個時間的
/// - `rate` / `baseAmount`：匯率是記帳當下鎖定的，新的一筆要重新查今天的
RepeatFields repeatFieldsOf(Expense expense) {
  return RepeatFields(
    title: expense.title,
    category: expense.category,
    currency: expense.currency,
    paidBy: expense.paidBy,
    splitMode: expense.splitMode,
    // 複製而不是共用，改新的一筆不會動到來源那筆。
    splits: Map<String, int>.from(expense.splits),
    place: expense.place?.copy(),
  );
}
