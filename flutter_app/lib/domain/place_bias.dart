import 'models.dart';

/// 地點搜尋的位置偏好。`src/utils/placeBias.ts` 的 Dart 版。
///
/// 解決的問題：「星巴克」「7-11」這種名字全世界都有，沒有位置資訊的話
/// Places 只能給全球結果，人在曼谷卻搜到台北的分店。
///
/// 這**不是** Nearby Search（那是另一個 SKU、沒有 session token 折扣）。
/// locationBias 只是 autocomplete 請求上的一個欄位，同一次計費，加了不會多花錢。

class LatLng {
  final double lat;
  final double lng;
  const LatLng(this.lat, this.lng);

  @override
  bool operator ==(Object other) =>
      other is LatLng && other.lat == lat && other.lng == lng;

  @override
  int get hashCode => Object.hash(lat, lng);

  @override
  String toString() => 'LatLng($lat, $lng)';
}

/// 偏好範圍的半徑（公尺）。
///
/// 30km 大約是一座城市加上近郊：在曼谷市中心記帳，機場、郊區夜市都還在範圍內，
/// 但不會偏好到隔壁國家。Places API 的圓形範圍上限是 50km。
const int biasRadiusMeters = 30000;

/// 挑一個偏好座標：清單裡第一個有座標的地點。
///
/// 呼叫端要由新到舊傳進來 —— 最近去過的地方最能代表「現在在哪」。
/// 只打名字沒選建議的地點沒有座標，跳過。
LatLng? biasFromPlaces(List<ExpensePlace?> places) {
  for (final place in places) {
    // 判斷的是 null 而不是「有沒有值」：赤道與本初子午線上的 0 是有效座標。
    final lat = place?.lat;
    final lng = place?.lng;
    if (lat != null && lng != null) return LatLng(lat, lng);
  }
  return null;
}

/// 包成 Places API (New) 要的形狀。
///
/// 沒有中心點就回傳 null，呼叫端不要把這個欄位放進請求，行為退回原本的
/// 全球搜尋。
///
/// 用 bias 而不是 restriction：restriction 會把範圍外的結果整個砍掉，
/// 萬一參考座標抓歪了（例如上一筆記的是機場、現在人在市區另一頭），
/// 使用者會搜不到明明存在的店，那種壞法很難理解。bias 只影響排序，
/// 最差的情況就跟沒有一樣。
Map<String, dynamic>? locationBias(LatLng? center) {
  if (center == null) return null;
  return {
    'circle': {
      'center': {'latitude': center.lat, 'longitude': center.lng},
      'radius': biasRadiusMeters,
    }
  };
}
