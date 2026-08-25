import 'currency.dart';
import 'models.dart';

/// 支出相關的兩件小事：「再記一筆」帶走什麼，以及移除成員前要說什麼。
/// `src/utils/repeatExpense.ts` 與 `memberRemoval.ts` 的 Dart 版。

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

/// 移除成員前的確認訊息。
///
/// 移除只拿掉權限，不動帳目：既有支出的 paidBy 與 splits 原封不動，
/// 結算也照樣把他算進去（參與者是從支出本身收集的，不是從成員名單）。
/// 真正改變的是他讀不到這個任務了 —— 所以未結清時要講清楚後果。
///
/// [balance] 正數代表還有人要付給他，負數代表他還沒付。
String removeMemberMessage({
  required String name,
  required int balance,
  required String currency,
}) {
  final who = name.isEmpty ? '這位成員' : name;
  String money(int amount) => '$currency ${formatAmount(amount, currency)}';

  if (balance == 0) {
    return '確定要把 $who 移出任務嗎？他就看不到這個任務了，但既有支出會保留。';
  }

  // 欠錢跟被欠錢的後果不一樣：前者是他付不了，後者是他看不到誰還沒還他。
  final situation = balance < 0
      ? '$who 還有 ${money(-balance)} 沒付。'
      : '還有 ${money(balance)} 要付給 $who。';

  final consequence = balance < 0
      ? '移出後他就看不到這個任務，也沒辦法自己記錄付款，只能由管理員代記。'
      : '移出後他就看不到這個任務，也查不到誰還沒付他錢。';

  return '$situation\n\n$consequence既有支出與結算金額都會保留。\n\n確定要移除嗎？';
}
