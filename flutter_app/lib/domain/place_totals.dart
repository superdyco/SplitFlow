import 'models.dart';
import 'settlement.dart';

/// 依地點彙總金額與筆數，給公開的旅費報告用。
/// `src/utils/placeTotals.ts` 的 Dart 版。
///
/// 報告的目的是「這樣玩一趟要花多少錢」，所以金額掛在地點上才有價值 ——
/// 讀者要知道的是「去大皇宮要準備多少」，地點名稱本身 Google 查得到。
///
/// 用 `baseAmountOf` 取金額，跟 `categoryTotals` 與 `settleExpenses` 同一套規則：
/// 缺匯率的支出三邊都排除。不一致的話報告裡的數字會互相矛盾，那比沒有報告更糟。

const String noPlaceLabel = '未指定地點';

class PlaceTotal {
  final String name;

  /// 從 Google 搜尋選出來的才有。純文字地點與「未指定地點」都是 null。
  final String? placeId;
  final double? lat;
  final double? lng;

  /// 主要幣別最小單位整數。
  final int total;
  final int expenseCount;

  const PlaceTotal({
    required this.name,
    required this.placeId,
    required this.lat,
    required this.lng,
    required this.total,
    required this.expenseCount,
  });

  PlaceTotal plus(int amount) => PlaceTotal(
        name: name,
        placeId: placeId,
        lat: lat,
        lng: lng,
        total: total + amount,
        expenseCount: expenseCount + 1,
      );
}

/// 分組的鍵：有 placeId 就用它（同一間店不同打法會合併），
/// 否則用名稱（使用者打一樣的名字就是指同一個地方）。
String _groupKey(Expense expense) {
  final place = expense.place;
  if (place == null) return noPlaceLabel;
  final placeId = place.placeId;
  return placeId != null && placeId.isNotEmpty
      ? placeId
      : 'name:${place.name}';
}

List<PlaceTotal> placeTotals(List<Expense> expenses, String baseCurrency) {
  final groups = <String, PlaceTotal>{};

  for (final expense in expenses) {
    final amount = baseAmountOf(expense, baseCurrency);
    if (amount == null) continue;

    final key = _groupKey(expense);
    final existing = groups[key];
    if (existing != null) {
      groups[key] = existing.plus(amount);
      continue;
    }

    final place = expense.place;
    groups[key] = PlaceTotal(
      name: place?.name ?? noPlaceLabel,
      placeId: place?.placeId,
      lat: place?.lat,
      lng: place?.lng,
      total: amount,
      expenseCount: 1,
    );
  }

  // 「未指定地點」不是目的地，是把剩下的錢交代清楚的那一列，所以固定排最後。
  // 名稱當次要排序依據，金額相同時結果才不會隨輸入順序跳動。
  return groups.values.toList()
    ..sort((a, b) {
      if (a.name == noPlaceLabel) return 1;
      if (b.name == noPlaceLabel) return -1;
      final byTotal = b.total.compareTo(a.total);
      return byTotal != 0 ? byTotal : a.name.compareTo(b.name);
    });
}

/// 超過這個數量就收起來。地圖標記上限是 20，二十幾列會把報告拉得很長，
/// 而報告要傳給沒去的人看，越短越有人看完。
const int placeLimit = 8;

class PlaceRow {
  final PlaceTotal place;

  /// 長條長度，0-1。「未指定地點」是 null，代表不畫。
  final double? bar;

  const PlaceRow({required this.place, required this.bar});
}

class VisiblePlaces {
  final List<PlaceRow> rows;

  /// 收起來沒顯示的地點數。沒有收起任何東西時是 0。
  final int hiddenCount;

  const VisiblePlaces({required this.rows, required this.hiddenCount});
}

/// 地點列表的顯示規則：截斷數量、算長條比例。
/// `src/utils/reportPlaces.ts` 的 Dart 版。
VisiblePlaces visiblePlaces(List<PlaceTotal> places, {int limit = placeLimit}) {
  final shown = places.take(limit).toList();

  // 基準有兩個講究：
  // 一、只看顯示出來的 —— 被收起來的使用者看不到，拿它當基準會讓第一列不滿格。
  // 二、排除「未指定地點」—— placeTotals 把它固定排最後，但它的金額可能是全場
  //     最大（一堆沒填地點的支出加總起來），拿它當基準會讓真正的地點全部縮水。
  var maxTotal = 0;
  for (final row in shown) {
    if (row.name == noPlaceLabel) continue;
    if (row.total > maxTotal) maxTotal = row.total;
  }

  return VisiblePlaces(
    rows: [
      for (final row in shown)
        PlaceRow(
          place: row,
          bar: row.name == noPlaceLabel || maxTotal <= 0
              ? null
              : row.total / maxTotal,
        ),
    ],
    hiddenCount: places.length - shown.length,
  );
}

/// 有座標的地點才畫得上靜態地圖。純文字輸入的地點沒有經緯度。
///
/// 上限直接由網址長度推出來，跟 `src/services/staticMap.ts` 同一套算法：
/// Static Maps 的網址上限 16384 字元，留 1384 給其餘參數，一個標記最長
/// 24 字元（`|-123.456789,-123.456789`），扣掉 `color:0xe8590c|` 那個開頭。
///
/// 本來寫死 20，那是保守過頭 —— 二十幾個地點的旅程並不罕見，而超過的地點
/// 會安靜地從地圖上消失，看的人不會知道少了什麼。
const int maxMarkers = (16384 - 1384 - 32) ~/ 24;

List<PlaceTotal> mappablePlaces(List<PlaceTotal> places, {int limit = maxMarkers}) {
  return places
      .where((place) => place.lat != null && place.lng != null)
      .take(limit)
      .toList();
}
