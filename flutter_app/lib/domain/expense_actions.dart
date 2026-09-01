import 'models.dart';

/// 對一筆支出能做什麼。
/// `src/utils/repeatExpense.ts` 與 `TaskPage.vue` 的 `canManage` 的 Dart 版。

/// 誰動得了這一筆支出。
///
/// 抽成純函式而不是寫在 widget 裡，理由跟 `payment_actions.dart` 一樣：
/// 這是**規則**不是畫面。firestore.rules 的 expenses update/delete 擋的是
/// 同一組條件，兩邊講的話必須一樣 —— 這裡放行而規則擋下，使用者就會
/// 填完整張表單才發現存不進去。
///
/// [isAdmin] 是 owner 或 adminIds 裡的人；[archived] 是任務已封存。
/// 封存之後誰都不能動，管理員也一樣 —— 規則就是這樣寫的。
bool canManageExpense({
  required Expense expense,
  required String uid,
  required bool isAdmin,
  required bool archived,
}) {
  if (archived) return false;
  // 未登入或讀取失敗時 uid 是空字串，而讀不出 createdBy 的支出那個欄位
  // 也是空字串。不先擋掉的話兩個空的會對上，等於把一筆作者不明的支出
  // 交給一個身分不明的人。
  if (uid.isEmpty) return false;
  if (isAdmin) return true;
  return expense.createdBy == uid || expense.paidBy == uid;
}

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
