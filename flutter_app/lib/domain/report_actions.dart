import 'category_totals.dart';
import 'models.dart';
import 'place_totals.dart';
import 'report.dart';
import 'report_timeline.dart';
import 'task_status.dart';
import 'trip_summary.dart';

/// 產生一份旅費報告要算的東西，以及誰能做這件事。
/// `src/composables/useTripReport.ts` 裡不碰網路的那一半。
///
/// 抽成純函式的理由跟 `canManageExpense` 一樣：**這裡決定什麼會被公開**。
/// 少放一個欄位不會有人發現，多放一個就是外洩，所以要有測試把欄位清單釘住。

/// 只有 owner 能對**已封存**的任務產生與撤銷報告。
///
/// 兩個條件，理由不同：
///
/// - **owner**：公開別人的消費資料只有他能決定 —— admin 也不行，rules 那邊
///   寫的是同一條。
/// - **已封存**：旅費參考的前提是數字定案。旅程進行到一半分享出去，別人拿到
///   的是不完整的預算，反而誤導。想更新就解除封存、改完再封存、重新產生。
///
/// rules 裡那句「不加 `taskIsActive`」不是這一條的反例，是它的補集：規則要放行
/// 的正是**封存**的任務（`taskIsActive` 會擋掉它們），而不是放行未封存的。
/// 後端因此擋不住未封存的任務 —— 這個函式是唯一的閘門。
bool canShareReport({required Task task, required String uid}) {
  if (uid.isEmpty || task.ownerId != uid) return false;
  return taskStatusFrom(task.status) == TaskStatus.archived;
}

/// 把任務與支出算成一份報告。
///
/// [listed] 由呼叫端帶進來而不是在這裡決定：重新產生不該偷偷改變公開狀態，
/// 本來公開的維持公開，本來沒有的維持沒有。
///
/// [mapPath] 是 null 就代表這份報告沒有地圖 —— 地圖是加分不是必要，
/// 拍不出來也照樣產得出報告。
TripReport buildReport({
  required String reportId,
  required Task task,
  required List<Expense> expenses,
  required String? mapPath,
  required bool listed,
}) {
  final currency = task.defaultCurrency;
  final summary = tripSummary(
    expenses: expenses,
    baseCurrency: currency,
    memberCount: task.memberCount,
    startDate: task.startDate,
    endDate: task.endDate,
  );

  return TripReport(
    id: reportId,
    taskName: task.name,
    currency: currency,
    startDate: task.startDate,
    endDate: task.endDate,
    days: summary.days,
    memberCount: task.memberCount,
    expenseCount: summary.expenseCount,
    total: summary.total,
    perPerson: summary.perPerson,
    categories: categoryTotals(expenses, currency),
    places: placeTotals(expenses, currency),
    timeline: reportTimeline(expenses, currency, task.startDate),
    mapPath: mapPath,
    // 產生就是開啟。要關掉是另一個動作，使用者按了才發生。
    active: true,
    listed: listed,
  );
}
