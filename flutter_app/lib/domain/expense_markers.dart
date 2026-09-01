import 'models.dart';

/// 把支出換成地圖上的標記。`src/pages/TaskPage.vue` 的 `expenseMarkers` 的
/// Dart 版。
///
/// 放在 domain 而不是 widget 裡，是因為「哪些支出畫得上地圖」跟「相機要框
/// 多大」都是規則，不是畫面 —— 而且這樣測得到（widget 那層要跑得動原生
/// 地圖 view 才驗得了）。

class MapMarker {
  /// 支出 id。標記要能對回是哪一筆。
  final String id;
  final double lat;
  final double lng;

  /// 點下去顯示的字。
  final String title;

  const MapMarker({
    required this.id,
    required this.lat,
    required this.lng,
    required this.title,
  });
}

/// 只有帶座標的支出畫得上地圖 —— 從地點搜尋清單選出來的才有座標，
/// 使用者自己打字的只有名字。順序照傳進來的，不重排。
List<MapMarker> expenseMarkers(List<Expense> expenses) {
  final markers = <MapMarker>[];

  for (final expense in expenses) {
    final place = expense.place;
    final lat = place?.lat;
    final lng = place?.lng;
    if (place == null || lat == null || lng == null) continue;

    markers.add(MapMarker(
      id: expense.id,
      lat: lat,
      lng: lng,
      // 兩個都放：只有支出名稱的話認不出是哪家店，只有地點名稱的話
      // 同一家店去兩次就分不出來。
      title: '${expense.title} · ${place.name}',
    ));
  }

  return markers;
}

/// 框住全部標記用的範圍。
class MarkerBounds {
  final double south;
  final double west;
  final double north;
  final double east;

  const MarkerBounds({
    required this.south,
    required this.west,
    required this.north,
    required this.east,
  });

  /// 範圍的中心。相機的初始位置用它 —— 之後才會再 fit 一次。
  double get centerLat => (south + north) / 2;
  double get centerLng => (west + east) / 2;
}

/// 空清單回 null，呼叫端就知道沒有東西可框，不用自己先檢查長度。
///
/// 跨換日線（東經 179 與西經 179）會框出一個繞地球一圈的範圍。不處理是
/// 因為那要判斷「哪一側比較短」，而一趟旅程的支出同時落在換日線兩邊
/// 這件事還沒發生過；真的發生了，看到的是一張太遠的地圖，不是壞掉。
MarkerBounds? markerBounds(List<MapMarker> markers) {
  if (markers.isEmpty) return null;

  var south = markers.first.lat;
  var north = markers.first.lat;
  var west = markers.first.lng;
  var east = markers.first.lng;

  for (final marker in markers.skip(1)) {
    if (marker.lat < south) south = marker.lat;
    if (marker.lat > north) north = marker.lat;
    if (marker.lng < west) west = marker.lng;
    if (marker.lng > east) east = marker.lng;
  }

  return MarkerBounds(south: south, west: west, north: north, east: east);
}
