/// 查一筆支出的天氣。
///
/// **Open-Meteo 的邏輯一行都不在這裡，也不在 Dart 的任何地方。** endpoint
/// 分流、URL 組裝、回應解析、timezone 全部在 `functions/src/weather.ts`，
/// 這裡只呼叫那個 callable。
///
/// 這是刻意的：`functions/` 跟兩個前端都沒有共用程式碼，如果各自查各自的，
/// 網頁一份、Flutter 一份、離線補寫的觸發器再一份 —— 三份實作分岔的症狀是
/// 「同一筆支出在手機和網頁顯示不同天氣」。
library;

import 'package:cloud_functions/cloud_functions.dart';

import '../domain/models.dart';

class WeatherRepository {
  /// 查不到就回 null。
  ///
  /// 呼叫端不需要區分「沒有座標」、「函式掛了」、「逾時」—— 那三件事對畫面
  /// 是同一件事：不顯示天氣。天氣是加分不是必要，這一層不該讓任何錯誤
  /// 冒到使用者面前，他正在記一筆帳。
  Future<Weather?> lookup({
    required ExpensePlace? place,
    required String date,
    required String time,
  }) async {
    // 自己打字的地點沒有座標。這跟地圖是同一個限制。
    if (place == null || place.lat == null || place.lng == null) return null;
    if (date.isEmpty) return null;

    try {
      // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
      final call = FirebaseFunctions.instanceFor(region: 'asia-east1')
          .httpsCallable('lookupWeather');
      final result = await call.call<Map<String, dynamic>?>({
        'lat': place.lat,
        'lng': place.lng,
        'date': date,
        'time': time,
      });

      final data = result.data;
      if (data == null) return null;

      final code = (data['code'] as num?)?.toInt();
      final high = (data['high'] as num?)?.toInt();
      final low = (data['low'] as num?)?.toInt();
      if (code == null || high == null || low == null) return null;

      return Weather(
        code: code,
        high: high,
        low: low,
        exact: (data['exact'] as num?)?.toInt(),
      );
    } catch (_) {
      return null;
    }
  }
}
