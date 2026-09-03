import 'package:test/test.dart';
import 'package:splitflow/domain/weather.dart';

/// WMO 有 28 個代碼，畫面上只需要分辨得出「那天大概是什麼樣子」，所以收成 8 組。
///
/// 這 8 條跟網頁版 `tests/weather.test.ts` **逐條對應**。兩邊分組不一樣的話，
/// 同一筆支出在手機和網頁會顯示不同的圖示 —— 而那是使用者唯一看得到的差異。
void main() {
  group('weatherKind', () {
    test('0 是晴', () {
      expect(weatherKind(0), WeatherKind.clear);
    });

    test('1–2 是多雲，3 是陰', () {
      expect(weatherKind(1), WeatherKind.cloudy);
      expect(weatherKind(2), WeatherKind.cloudy);
      expect(weatherKind(3), WeatherKind.overcast);
    });

    test('45、48 是霧', () {
      expect(weatherKind(45), WeatherKind.fog);
      expect(weatherKind(48), WeatherKind.fog);
    });

    test('51–57 是毛毛雨', () {
      expect(weatherKind(51), WeatherKind.drizzle);
      expect(weatherKind(55), WeatherKind.drizzle);
      expect(weatherKind(57), WeatherKind.drizzle);
    });

    test('61–67 與 80–82 是雨', () {
      expect(weatherKind(61), WeatherKind.rain);
      expect(weatherKind(65), WeatherKind.rain);
      expect(weatherKind(80), WeatherKind.rain);
      expect(weatherKind(82), WeatherKind.rain);
    });

    test('71–77 與 85–86 是雪', () {
      expect(weatherKind(71), WeatherKind.snow);
      expect(weatherKind(77), WeatherKind.snow);
      expect(weatherKind(85), WeatherKind.snow);
    });

    test('95–99 是雷', () {
      expect(weatherKind(95), WeatherKind.thunder);
      expect(weatherKind(99), WeatherKind.thunder);
    });

    test('認不得的代碼退回陰天，不是晴天', () {
      // 退回晴天的話，一個查錯的代碼會變成「那天天氣很好」——
      // 那是一句沒有根據的話。陰天是最中性的說法。
      expect(weatherKind(7), WeatherKind.overcast);
      expect(weatherKind(-1), WeatherKind.overcast);
    });
  });
}
