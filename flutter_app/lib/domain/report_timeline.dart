import 'expense_date.dart';
import 'models.dart';
import 'settlement.dart';
import 'trip_summary.dart';

/// 公開旅費報告的時間軸：一天一段，裡面照時間排的支出。
/// `src/utils/reportTimeline.ts` 的 Dart 版。
///
/// **這是要放進公開文件的資料，所以只放時間、分類、地點與金額** ——
/// 沒有支出名稱、沒有 uid、沒有誰付的。分類與地點本來就已經公開在
/// 「花在哪」與「去過的地方」兩區，時間軸只是把它們按當天的順序重排一次；
/// 名稱則是自己人才看得懂的東西（「阿明的點心」），不該跟著連結傳出去。
///
/// 金額同樣用 `baseAmountOf`，跟 tripSummary / categoryTotals / placeTotals
/// 同一套規則：缺匯率的支出四邊都排除。不一致的話每日小計加起來不等於總額。

class ReportEntry {
  /// `"HH:MM"`。沒記時間是空字串 —— 舊支出與懶得填的都會是這樣。
  final String time;
  final ExpenseCategory category;

  /// 地點名稱，沒有就是 null。不放 placeId 與座標，那是地圖那邊的事。
  final String? place;

  /// 主要幣別最小單位整數。
  final int amount;

  const ReportEntry({
    required this.time,
    required this.category,
    required this.place,
    required this.amount,
  });
}

class ReportDay {
  /// `"YYYY-MM-DD"`。
  final String date;

  /// 旅程的第幾天，從 1 起算。
  final int day;

  /// 當天小計。
  final int total;
  final List<ReportEntry> entries;

  const ReportDay({
    required this.date,
    required this.day,
    required this.total,
    required this.entries,
  });
}

/// 一天之內：有記時間的照時間由早到晚排在前面，沒記時間的維持加入順序接在後面。
///
/// 沒記時間的不能塞在中間 —— 那等於幫使用者猜它發生在哪兩筆之間，猜錯了讀者
/// 也看不出來。排在最後至少是誠實的「這幾筆不知道幾點」。
///
/// 比到最後要比 seq（加入順序）：**Dart 的 `List.sort` 不保證穩定**，
/// 網頁版靠 `Array.prototype.sort` 的穩定性維持的那個順序，這裡得自己講明白。
int _compareEntries((int, ReportEntry) a, (int, ReportEntry) b) {
  final timeOfA = a.$2.time;
  final timeOfB = b.$2.time;
  if (timeOfA.isNotEmpty && timeOfB.isNotEmpty) {
    final byTime = timeOfA.compareTo(timeOfB);
    if (byTime != 0) return byTime;
  } else if (timeOfA.isNotEmpty) {
    return -1;
  } else if (timeOfB.isNotEmpty) {
    return 1;
  }
  return a.$1.compareTo(b.$1);
}

/// 第幾天的原點：任務有設起始日就用它（使用者自己宣告的行程第一天），
/// 但如果有支出早於它（提前買的機票之類），就退回用最早的那天，
/// 免得算出 Day 0 或負數。
String _originDay(String firstDate, String? startDate) {
  return startDate != null &&
          startDate.isNotEmpty &&
          startDate.compareTo(firstDate) < 0
      ? startDate
      : firstDate;
}

class _Building {
  final String date;

  /// 帶著加入順序，排序時當最後一道 tie-break。
  final List<(int, ReportEntry)> entries = [];
  int total = 0;
  _Building(this.date);
}

List<ReportDay> reportTimeline(
  List<Expense> expenses,
  String baseCurrency, [
  String? startDate,
]) {
  final days = <String, _Building>{};

  // 先排成「由舊到新」再分組：同一天裡沒記時間的那幾筆就會照記帳先後排，
  // 而不是跟著呼叫端傳進來的順序跑。時間軸是順著看的，跟支出列表相反。
  final ordered = [...expenses]..sort(compareExpenses);
  final oldestFirst = ordered.reversed;

  for (final expense in oldestFirst) {
    final amount = baseAmountOf(expense, baseCurrency);
    if (amount == null) continue;

    // 連日期都沒有的支出（沒填、createdAt 也還沒回來）放不上時間軸。
    // 它仍然算在總額裡，只是這裡沒有位置給它。
    final date = expenseDate(expense);
    if (date.isEmpty) continue;

    final group = days.putIfAbsent(date, () => _Building(date));
    group.total += amount;
    group.entries.add((
      group.entries.length,
      ReportEntry(
        time: expenseTime(expense),
        category: expense.category,
        place: expense.place?.name,
        amount: amount,
      ),
    ));
  }

  final sorted = days.values.toList()
    ..sort((a, b) => a.date.compareTo(b.date));
  if (sorted.isEmpty) return const [];

  final origin = _originDay(sorted.first.date, startDate);
  for (final group in sorted) {
    group.entries.sort(_compareEntries);
  }

  return [
    for (final (index, group) in sorted.indexed)
      ReportDay(
        date: group.date,
        // 日期格式壞掉時退回用序號，寧可 Day 編號不準也不要整個時間軸消失。
        day: daysBetween(origin, group.date) ?? index + 1,
        total: group.total,
        entries: [for (final entry in group.entries) entry.$2],
      ),
  ];
}
