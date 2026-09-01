import 'expense_date.dart';
import 'models.dart';
import 'settlement.dart';

/// 旅程的整體數字：天數、總額、每人平均。`src/utils/tripSummary.ts` 的 Dart 版。
///
/// 每人平均是「總額 ÷ 人數」，不是每個人的實際分攤 ——
/// 實際分攤會洩漏誰花得多，而且對報告的讀者沒有用，他要的是
/// 「這種玩法一個人大概多少」。簡單平均同時滿足隱私與用途。

class TripSummary {
  /// 旅程天數，含頭尾。算不出來是 null。
  final int? days;

  /// 主要幣別最小單位整數。
  final int total;
  final int perPerson;

  /// 列入計算的筆數（缺匯率的已排除）。
  final int expenseCount;

  const TripSummary({
    required this.days,
    required this.total,
    required this.perPerson,
    required this.expenseCount,
  });
}

final RegExp _dayPattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

/// 用 UTC 解析 `"YYYY-MM-DD"`。
///
/// 一定要是 UTC：`DateTime(y, m, d)` 是本地時區，跨月跨年的日光節約時間
/// 會讓兩個日期相減少掉或多出一小時，天數就會差一天。
DateTime? _parseDay(String value) {
  final match = _dayPattern.firstMatch(value);
  if (match == null) return null;
  return DateTime.utc(
    int.parse(match.group(1)!),
    int.parse(match.group(2)!),
    int.parse(match.group(3)!),
  );
}

/// 含頭尾，所以同一天是 1 天不是 0 天。
///
/// 時間軸算「第幾天」也是同一套算法（`daysBetween(第一天, 那天)`），
/// 兩邊各寫一份日期數學遲早會對不起來。
int? daysBetween(String start, String end) {
  final from = _parseDay(start);
  final to = _parseDay(end);
  if (from == null || to == null) return null;
  return to.difference(from).inDays + 1;
}

TripSummary tripSummary({
  required List<Expense> expenses,
  required String baseCurrency,
  required int memberCount,
  String? startDate,
  String? endDate,
}) {
  var total = 0;
  var expenseCount = 0;
  final dates = <String>[];

  for (final expense in expenses) {
    final amount = baseAmountOf(expense, baseCurrency);
    if (amount == null) continue;
    total += amount;
    expenseCount += 1;
    dates.add(expenseDate(expense));
  }

  // 任務有設起迄就用那個，那是使用者自己宣告的旅程範圍，比支出日期準。
  int? days;
  if (startDate != null &&
      startDate.isNotEmpty &&
      endDate != null &&
      endDate.isNotEmpty) {
    days = daysBetween(startDate, endDate);
  } else if (dates.isNotEmpty) {
    final sorted = [...dates]..sort();
    days = daysBetween(sorted.first, sorted.last);
  }

  return TripSummary(
    days: days,
    total: total,
    // 除以 0 是任務資料壞掉才會發生的事，那時給 0 比讓整份報告產不出來好。
    perPerson: memberCount > 0 ? (total / memberCount).round() : 0,
    expenseCount: expenseCount,
  );
}
