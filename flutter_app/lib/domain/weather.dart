/// WMO 天氣代碼的分組。`src/types/weather.ts` 的 Dart 版。
///
/// 分組必須跟網頁版逐條一致：不一致的話，同一筆支出在手機和網頁會顯示
/// 不同的圖示，而那是使用者唯一看得到的差異。兩邊的測試也是逐條對應的。
library;

/// 畫面上分辨得出來的八種天氣。
enum WeatherKind { clear, cloudy, overcast, fog, drizzle, rain, snow, thunder }

/// WMO 的 28 個代碼收成 8 組。
///
/// 認不得的一律當陰天。**方向很重要**：退回晴天的話，一個查錯的代碼會變成
/// 「那天天氣很好」，那是一句沒有根據的話；陰天是最中性的說法。
WeatherKind weatherKind(int code) {
  if (code == 0) return WeatherKind.clear;
  if (code == 1 || code == 2) return WeatherKind.cloudy;
  if (code == 3) return WeatherKind.overcast;
  if (code == 45 || code == 48) return WeatherKind.fog;
  if (code >= 51 && code <= 57) return WeatherKind.drizzle;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return WeatherKind.rain;
  }
  if ((code >= 71 && code <= 77) || code == 85 || code == 86) {
    return WeatherKind.snow;
  }
  if (code >= 95 && code <= 99) return WeatherKind.thunder;
  return WeatherKind.overcast;
}
