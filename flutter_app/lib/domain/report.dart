import 'category_totals.dart';
import 'place_totals.dart';
import 'report_timeline.dart';

/// 公開的旅費報告快照。`src/types/report.ts` 的 Dart 版。
///
/// **這份文件任何人拿到連結都讀得到**，所以裡面絕對不能有 uid、成員暱稱、
/// 支出名稱或誰欠誰。只放算好的彙總數字。
///
/// `timeline` 是這條規則唯一逐筆列出來的地方，它同樣不含名稱與人 ——
/// 只有時間、分類、地點、金額，全都是這份文件其他欄位已經公開過的種類。
class TripReport {
  final String id;
  final String taskName;
  final String currency;
  final String? startDate;
  final String? endDate;

  /// 旅程天數，含頭尾。算不出來是 null。
  final int? days;
  final int memberCount;

  /// 列入計算的支出筆數（缺匯率的已排除）。
  final int expenseCount;
  final int total;
  final int perPerson;
  final List<CategoryTotal> categories;
  final List<PlaceTotal> places;

  /// 一天一段的行程時間軸。這個功能之前產生的報告是空陣列。
  final List<ReportDay> timeline;

  /// Storage 物件路徑。沒有地圖時是 null。
  final String? mapPath;

  /// 撤銷就是這個變 false。拿到連結的人讀不讀得到，看這個。
  final bool active;

  /// 要不要列進「探索」那一頁讓所有人瀏覽得到。
  ///
  /// 跟 `active` 是兩件事：`active` 是「拿到連結的人看不看得到」，這個是
  /// 「陌生人找不找得到」。只想傳給朋友的人，連結開著但這個不勾。
  final bool listed;

  /// 最後一次重新產生的時間，報告上顯示這個。離線寫入時還沒回來，是 null。
  final DateTime? updatedAt;

  const TripReport({
    required this.id,
    required this.taskName,
    required this.currency,
    required this.startDate,
    required this.endDate,
    required this.days,
    required this.memberCount,
    required this.expenseCount,
    required this.total,
    required this.perPerson,
    required this.categories,
    required this.places,
    required this.timeline,
    required this.mapPath,
    required this.active,
    required this.listed,
    this.updatedAt,
  });
}

/// 探索頁列出來的報告。
///
/// 多一個 taskId 是因為報告文件本身不存自己的任務 id —— 它藏在路徑裡，
/// 而 collection group 查詢回來之後路徑就散了。連結要靠它才組得出來。
class PublicReport {
  final String taskId;
  final TripReport report;

  const PublicReport({required this.taskId, required this.report});
}
