import 'report.dart';

/// 收藏的純邏輯：id 怎麼組、報告怎麼壓成一份快照。
/// `src/utils/favorites.ts` 與 `src/types/favorite.ts` 的 Dart 版。

/// 收藏起來的旅費報告。存在 `users/{uid}/favorites/{taskId}_{reportId}`，
/// **純私人資料，只有自己讀得到**。
///
/// 刻意存一份快照而不是只存 taskId + reportId：收藏頁如果只存兩個 id，
/// 每畫一列就要多讀一次報告文件，二十筆收藏就是二十趟往返。而這一頁要的
/// 只是名字、天數、總額這幾個字，抄一份下來就能一次查詢畫完。
///
/// 代價是原作者重新產生報告後，收藏裡的數字會停在收藏當下 —— 對「我存起來
/// 之後想再看看」這個用途，那反而是對的：看到的是你當初收藏的那一版。
/// 點進去看到的報告永遠是最新的。
class FavoriteReport {
  /// `${taskId}_${reportId}`。用固定 id 才不會同一份報告收藏兩次。
  final String id;
  final String taskId;
  final String reportId;
  final String taskName;
  final String currency;
  final String? startDate;
  final String? endDate;

  /// 旅程天數，含頭尾。算不出來是 null。
  final int? days;
  final int memberCount;

  /// 收藏當下的總額，最小單位整數。
  final int total;

  const FavoriteReport({
    required this.id,
    required this.taskId,
    required this.reportId,
    required this.taskName,
    required this.currency,
    required this.startDate,
    required this.endDate,
    required this.days,
    required this.memberCount,
    required this.total,
  });
}

/// 收藏文件的 id。
///
/// 用 `taskId_reportId` 這種算得出來的 id，而不是隨機 id：
///
///   - 同一份報告按兩次收藏只會蓋寫同一份，不會變成兩筆
///   - 「這份我收藏過了嗎」是一次 doc 讀取，不用先查一遍清單
///
/// 兩個 id 都是 Firestore 的自動 id（英數字，不含底線），所以底線當分隔符
/// 不會撞到內容。
String favoriteId(String taskId, String reportId) => '${taskId}_$reportId';

/// 把一份報告壓成要存進收藏的樣子。
///
/// 明確列出每一個欄位而不是整份帶過 —— 報告以後多了什麼（時間軸、地點、
/// 分類明細）都不該自動跟著跑進使用者的收藏裡。收藏頁畫不到的東西就不要存。
FavoriteReport toFavorite(
  String taskId,
  String reportId,
  TripReport report,
) {
  return FavoriteReport(
    id: favoriteId(taskId, reportId),
    taskId: taskId,
    reportId: reportId,
    taskName: report.taskName,
    currency: report.currency,
    startDate: report.startDate,
    endDate: report.endDate,
    days: report.days,
    memberCount: report.memberCount,
    total: report.total,
  );
}
