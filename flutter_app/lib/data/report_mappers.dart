import '../domain/category_totals.dart';
import '../domain/favorites.dart';
import '../domain/models.dart';
import '../domain/place_totals.dart';
import '../domain/report.dart';
import '../domain/report_timeline.dart';

/// 報告與收藏的 Firestore 文件 ↔ 領域模型。
/// `src/services/reportService.ts` 的 `toReport` 與寫入那一段的 Dart 版。
///
/// 跟 `mappers.dart` 一樣**刻意不 import `cloud_firestore`**：這一層是
/// 「舊文件缺欄位」的 bug 最常出現的地方，要能用純 Dart 的 test 跑。
/// 時間戳由呼叫端先轉成 DateTime。
///
/// **寫入的形狀必須跟網頁版一模一樣**：同一份報告可能是網頁版產生的，
/// 也可能是 App 產生的，而兩邊讀的是同一份文件。

// ------------------------------------------------------------------ 讀

/// 報告文件 → 領域模型。
///
/// 兩個欄位要補值，方向都偏向「不外洩」：
///
///   - `timeline`：時間軸功能之前的報告沒有，補成空陣列，畫面就只要處理
///     一種形狀。那些報告重新產生一次就會真的補上。
///   - `listed`：公開到探索頁之前的報告沒有這個 key，一律當成沒公開 ——
///     沒有人該在不知情的狀況下被列出來。
TripReport reportFromMap(
  String id,
  Map<String, dynamic> data,
  DateTime? updatedAt,
) {
  return TripReport(
    id: id,
    taskName: (data['taskName'] as String?) ?? '',
    currency: (data['currency'] as String?) ?? '',
    startDate: _nonEmpty(data['startDate']),
    endDate: _nonEmpty(data['endDate']),
    days: (data['days'] as num?)?.toInt(),
    memberCount: (data['memberCount'] as num?)?.toInt() ?? 0,
    expenseCount: (data['expenseCount'] as num?)?.toInt() ?? 0,
    total: (data['total'] as num?)?.toInt() ?? 0,
    perPerson: (data['perPerson'] as num?)?.toInt() ?? 0,
    categories: _categories(data['categories']),
    places: _places(data['places']),
    timeline: _timeline(data['timeline']),
    mapPath: _nonEmpty(data['mapPath']),
    // active 缺了就當關閉：報告讀不到只是看不到，猜錯成公開才是外洩。
    active: data['active'] == true,
    listed: data['listed'] == true,
    updatedAt: updatedAt,
  );
}

List<CategoryTotal> _categories(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map)
        CategoryTotal(
          category: categoryFrom(item['category'] as String?),
          total: (item['total'] as num?)?.toInt() ?? 0,
          share: (item['share'] as num?)?.toDouble() ?? 0,
        ),
  ];
}

List<PlaceTotal> _places(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map)
        PlaceTotal(
          name: (item['name'] as String?) ?? noPlaceLabel,
          placeId: item['placeId'] as String?,
          lat: (item['lat'] as num?)?.toDouble(),
          lng: (item['lng'] as num?)?.toDouble(),
          total: (item['total'] as num?)?.toInt() ?? 0,
          expenseCount: (item['expenseCount'] as num?)?.toInt() ?? 0,
        ),
  ];
}

List<ReportDay> _timeline(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map)
        ReportDay(
          date: (item['date'] as String?) ?? '',
          day: (item['day'] as num?)?.toInt() ?? 0,
          total: (item['total'] as num?)?.toInt() ?? 0,
          entries: _entries(item['entries']),
        ),
  ];
}

List<ReportEntry> _entries(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map)
        ReportEntry(
          time: (item['time'] as String?) ?? '',
          category: categoryFrom(item['category'] as String?),
          place: _nonEmpty(item['place']),
          amount: (item['amount'] as num?)?.toInt() ?? 0,
        ),
  ];
}

FavoriteReport favoriteFromMap(String id, Map<String, dynamic> data) {
  return FavoriteReport(
    id: id,
    taskId: (data['taskId'] as String?) ?? '',
    reportId: (data['reportId'] as String?) ?? '',
    taskName: (data['taskName'] as String?) ?? '',
    currency: (data['currency'] as String?) ?? '',
    startDate: _nonEmpty(data['startDate']),
    endDate: _nonEmpty(data['endDate']),
    days: (data['days'] as num?)?.toInt(),
    memberCount: (data['memberCount'] as num?)?.toInt() ?? 0,
    total: (data['total'] as num?)?.toInt() ?? 0,
  );
}

// ------------------------------------------------------------------ 寫

/// 報告文件的欄位。
///
/// **不含 createdAt 與 updatedAt** —— 那兩個是 serverTimestamp，只有
/// repository 那層碰得到，而且第一次產生與重新產生寫的欄位不一樣
/// （重新產生不能碰 createdAt，不然連結還在、產生日期卻被洗掉）。
Map<String, dynamic> reportToMap(TripReport report) {
  return {
    'taskName': report.taskName,
    'currency': report.currency,
    'startDate': report.startDate,
    'endDate': report.endDate,
    'days': report.days,
    'memberCount': report.memberCount,
    'expenseCount': report.expenseCount,
    'total': report.total,
    'perPerson': report.perPerson,
    'categories': [
      for (final item in report.categories)
        {
          'category': item.category.name,
          'total': item.total,
          'share': item.share,
        },
    ],
    'places': [
      for (final place in report.places)
        {
          'name': place.name,
          'placeId': place.placeId,
          'lat': place.lat,
          'lng': place.lng,
          'total': place.total,
          'expenseCount': place.expenseCount,
        },
    ],
    'timeline': [
      for (final day in report.timeline)
        {
          'date': day.date,
          'day': day.day,
          'total': day.total,
          'entries': [
            for (final entry in day.entries)
              {
                'time': entry.time,
                'category': entry.category.name,
                'place': entry.place,
                'amount': entry.amount,
              },
          ],
        },
    ],
    'mapPath': report.mapPath,
    'active': report.active,
    'listed': report.listed,
  };
}

/// 收藏文件的欄位。**不含 savedAt**，理由同上。
///
/// 規則限制一份收藏最多 16 個欄位，這裡是 9 個。
Map<String, dynamic> favoriteToMap(FavoriteReport favorite) {
  return {
    'taskId': favorite.taskId,
    'reportId': favorite.reportId,
    'taskName': favorite.taskName,
    'currency': favorite.currency,
    'startDate': favorite.startDate,
    'endDate': favorite.endDate,
    'days': favorite.days,
    'memberCount': favorite.memberCount,
    'total': favorite.total,
  };
}

String? _nonEmpty(dynamic value) {
  if (value is! String || value.isEmpty) return null;
  return value;
}
