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

/// 每一組的中文名。
///
/// 加這個是因為小尺寸的圖示分不出「雷雨」與「毛毛雨」—— 兩個字比任何圖示
/// 都好認。圖示負責一眼掃到，文字負責講清楚。
///
/// 顏色不放這裡：那需要 import material，而這個檔案是純 Dart，
/// 測試才跑得動 package:test。顏色在 ui/weather_chip.dart。
const Map<WeatherKind, String> weatherLabels = {
  WeatherKind.clear: '晴',
  WeatherKind.cloudy: '多雲',
  WeatherKind.overcast: '陰',
  WeatherKind.fog: '霧',
  WeatherKind.drizzle: '毛毛雨',
  WeatherKind.rain: '雨',
  WeatherKind.snow: '雪',
  WeatherKind.thunder: '雷雨',
};
