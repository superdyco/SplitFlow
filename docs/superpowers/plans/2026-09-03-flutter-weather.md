# 手機版支出天氣 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓手機版跟網頁版一樣顯示與儲存支出的天氣，並且**產生的報告文件形狀一致** —— 目前從手機產生的報告會沒有天氣。

**Architecture:** **不重寫任何 Open-Meteo 的邏輯。** Flutter 呼叫網頁版那一輪已經做好並驗證過的 `lookupWeather` callable，拿到算好的結果。這一輪只有值物件、mapper、圖示分組與四個顯示位置。由下而上：型別與分組（TDD）→ mapper → repository → 四個畫面。

**Tech Stack:** Flutter / Dart，`cloud_functions`（已在依賴裡），Material Icons，vitest 的對應物是 `flutter test`。

**Spec:** `docs/superpowers/specs/2026-09-03-expense-weather-design.md`（特別是 §11）

## Global Constraints

- **不重寫 Open-Meteo 的邏輯。** endpoint 分流、URL 組裝、回應解析、`timezone=auto`、錯誤處理全部留在 `functions/src/weather.ts`。Dart 這邊只呼叫 callable。
- **不動 `functions/`、`src/`、`firestore.rules`。** 那三個在網頁版那一輪已經完成並驗證過。
- **天氣缺席是正常狀態。** 沒座標、查不到、離線都直接不顯示，**不出現錯誤訊息，絕不擋存檔**。
- **攝氏、整數、不做華氏。**
- **圖示用 Material Icons，不畫 SVG。** 跟這一輪把分類圖示換成 `IconData` 同一套。
- **中文註解，寫「為什麼」不寫「做了什麼」。**
- **這個 repo 的工作區檔案是 CRLF 行尾。** 腳本取代時樣板字串的換行對不上會**靜默失敗**。
- **這台開發機沒有 Flutter。** `flutter analyze` 與 `flutter test` 要在有 Flutter 的機器上跑。**沒跑過不准打勾，也不准在 commit message 裡宣稱測試過。**

### 基線

這個分支上還有 19 個沒編譯過的視覺改版 commit，所以**基線本身可能是紅的**。第一件事是確認基線，不要把視覺改版的錯誤誤認成天氣的錯誤：

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd <repo>\flutter_app
dart format lib/ test/
flutter analyze
flutter test
```

### 已經做好、不要重做的東西

`lookupWeather` callable（`functions/src/index.ts`）已部署可用，region `asia-east1`，輸入輸出：

```
輸入： { lat: double, lng: double, date: "YYYY-MM-DD", time: "HH:MM" 或 "" }
輸出： { code: int, high: int, low: int, exact: int|null }  或  null
```

`deleteAccount` 的呼叫方式在 `data/auth_repository.dart:172` 有現成範例。

---

## File Structure

**新增**

| 檔案 | 責任 |
|---|---|
| `flutter_app/lib/domain/weather.dart` | `WeatherKind` 與 `weatherKind(code)` |
| `flutter_app/test/weather_test.dart` | 分組的 8 條測試 |
| `flutter_app/lib/data/weather_repository.dart` | 呼叫 callable，查不到回 null |
| `flutter_app/lib/ui/weather_chip.dart` | 圖示＋溫度，四個位置共用 |

**修改**

| 檔案 | 變更 |
|---|---|
| `lib/domain/models.dart` | 加 `Weather` 值物件，`Expense` 加 `weather` |
| `lib/data/mappers.dart` | `_weatherFrom` |
| `lib/domain/report_timeline.dart` | `ReportDay` 加 weather 與挑選規則 |
| `flutter_app/test/report_timeline_test.dart` | 挑選規則的 4 條測試 |
| `lib/data/report_mappers.dart` | 讀與寫**兩邊**都加 |
| `lib/ui/expense_form_page.dart` | 查詢、顯示、存檔 |
| `lib/ui/expense_row.dart` | 地點那條線索行 |
| `lib/ui/expense_detail_page.dart` | 地點區 |
| `lib/ui/report_page.dart` | 日表頭 |

---

## Task 1: 型別與 WMO 分組

**Files:**
- Create: `flutter_app/lib/domain/weather.dart`
- Create: `flutter_app/test/weather_test.dart`
- Modify: `flutter_app/lib/domain/models.dart`

**Interfaces:**
- Produces：`Weather`、`WeatherKind`、`weatherKind(code)`。後面每個 Task 都用。

- [ ] **Step 1: 寫會失敗的測試**

建立 `flutter_app/test/weather_test.dart`：

```dart
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
```

- [ ] **Step 2: 跑測試確認會失敗**

```powershell
flutter test test/weather_test.dart
```

Expected: 編譯失敗，找不到 `package:splitflow/domain/weather.dart`。

- [ ] **Step 3: 實作分組**

建立 `flutter_app/lib/domain/weather.dart`：

```dart
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
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
flutter test test/weather_test.dart
```

Expected: 8 條全綠。

- [ ] **Step 5: 加 `Weather` 值物件**

`lib/domain/models.dart`，在 `class ExpensePlace` 之後加：

```dart
/// 支出當時、當地的天氣。`functions/src/weather.ts` 的 `WeatherResult` 的
/// Dart 版，欄位逐一對應。
///
/// 兩邊各自宣告是刻意的：`functions/` 是獨立套件。形狀要對得上，
/// 改一邊要記得改另一邊。
class Weather {
  /// WMO 天氣代碼 0–99。決定圖示。
  final int code;

  /// 當日最高溫，攝氏整數。
  final int high;

  /// 當日最低溫，攝氏整數。
  final int low;

  /// 那個小時的實測溫度。**只有支出填了時間才有。**
  ///
  /// 有它就印「28°」，沒有就印「24–33°」—— 顯示形式直接反映這筆有沒有記
  /// 時間，不假裝出沒有的精度。
  final int? exact;

  const Weather({
    required this.code,
    required this.high,
    required this.low,
    required this.exact,
  });
}
```

- [ ] **Step 6: `Expense` 加欄位**

在 `Expense` 的 `final ExpensePlace? place;` 之後加：

```dart
  /// 那天那個地點的天氣。地點沒有座標、查不到、或離線記帳還沒被觸發器
  /// 補寫時都是 null。缺席是正常狀態，不是錯誤。
  final Weather? weather;
```

建構子的具名參數加 `this.weather`（**不加 `required`** —— 它是選填的）。

- [ ] **Step 7: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze 回到基線；測試比基線多 8 條。

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/domain/weather.dart flutter_app/test/weather_test.dart flutter_app/lib/domain/models.dart
git commit -F - <<'MSG'
Group the weather codes the same way the web does

Eight buckets over WMO's 28 codes, matching src/types/weather.ts line
for line, and the eight tests match tests/weather.test.ts the same way.
Divergence here would show up as the one difference a user can actually
see: the same expense wearing a different icon on the phone than on the
web.

Unknown codes fall back to overcast rather than clear, because a lookup
failure should not turn into "the weather was lovely".
MSG
```

---

## Task 2: mapper 與 repository

**Files:**
- Modify: `flutter_app/lib/data/mappers.dart`
- Create: `flutter_app/lib/data/weather_repository.dart`

**Interfaces:**
- Consumes：Task 1 的 `Weather`。
- Produces：`WeatherRepository.lookup(place, date, time)`。Task 4 用。

- [ ] **Step 1: mapper 讀出天氣**

`lib/data/mappers.dart`，在 `_placeFrom` 之後加：

```dart
/// 比照 `_placeFrom`：欄位不對就整個回 null，不丟例外。
///
/// 天氣是裝飾欄位，一筆支出不該因為天氣的形狀壞掉就整筆讀不出來。
Weather? _weatherFrom(dynamic value) {
  if (value is! Map) return null;

  final code = (value['code'] as num?)?.toInt();
  final high = (value['high'] as num?)?.toInt();
  final low = (value['low'] as num?)?.toInt();
  if (code == null || high == null || low == null) return null;

  return Weather(
    code: code,
    high: high,
    low: low,
    exact: (value['exact'] as num?)?.toInt(),
  );
}
```

然後在建構 `Expense` 的地方（`place: _placeFrom(data['place']),` 那一行之後）加：

```dart
    weather: _weatherFrom(data['weather']),
```

- [ ] **Step 2: 建立 repository**

`lib/data/weather_repository.dart`：

```dart
/// 查一筆支出的天氣。
///
/// **Open-Meteo 的邏輯一行都不在這裡。** endpoint 分流、URL 組裝、回應解析、
/// timezone 全部在 `functions/src/weather.ts`，這裡只呼叫那個 callable。
///
/// 這是刻意的：`functions/` 跟前端沒有共用程式碼，如果各自查各自的，
/// 網頁一份、Flutter 一份、離線補寫的觸發器再一份 —— 三份分岔的症狀是
/// 「同一筆支出在手機和網頁顯示不同天氣」。
library;

import 'package:cloud_functions/cloud_functions.dart';

import '../domain/models.dart';

class WeatherRepository {
  /// 查不到就回 null。呼叫端不需要區分「沒有座標」、「函式掛了」、「逾時」
  /// —— 那三件事對畫面是同一件事：不顯示天氣。
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
      // 天氣是加分不是必要。查不到就當作沒有，不要讓使用者看到錯誤訊息 ——
      // 他正在記一筆帳，那才是他來這一頁的目的。
      return null;
    }
  }
}
```

- [ ] **Step 3: 加 provider**

`lib/state/providers.dart`，比照既有的 repository provider 加：

```dart
final weatherRepositoryProvider = Provider((ref) => WeatherRepository());
```

**先讀那個檔案裡既有的 provider 怎麼寫**，照同一個形式，不要自己發明。

- [ ] **Step 4: analyze 與測試**

```powershell
flutter analyze
flutter test
```

- [ ] **Step 5: Commit**

```bash
git add flutter_app/lib/data/mappers.dart flutter_app/lib/data/weather_repository.dart flutter_app/lib/state/providers.dart
git commit -F - <<'MSG'
Call the weather function instead of reimplementing it in Dart

The repository does nothing but hand coordinates and a date to the
callable the web round already built and verified. Endpoint choice,
timezone handling and parsing stay in one place; a Dart copy would make
three implementations of the same request and the drift would surface as
one expense showing different weather on phone and web.

Every failure returns null. No coordinates, a dead function and a
timeout are three causes of one outcome, and none of them is worth an
error message on a screen where someone is recording a number.

The mapper follows _placeFrom: a malformed weather map yields null
rather than throwing, because a decorative field must not make a whole
expense unreadable.
MSG
```

---

## Task 3: 報告時間軸

**Files:**
- Modify: `flutter_app/lib/domain/report_timeline.dart`
- Modify: `flutter_app/test/report_timeline_test.dart`
- Modify: `flutter_app/lib/data/report_mappers.dart`

### 3.0 這是這一輪存在的理由

`report_mappers.dart` 的時間軸序列化是**雙向**的。不做這個 Task，從手機產生的報告就沒有天氣，而從網頁產生的有 —— 同一個功能兩種文件形狀。

- [ ] **Step 1: 寫會失敗的測試**

在 `flutter_app/test/report_timeline_test.dart` 加一個 group（**先讀那個檔案既有的 `Expense` 建構輔助函式**，沿用它，不要另外寫一個）：

```dart
  group('每天的天氣', () {
    const sunny = Weather(code: 0, high: 30, low: 22, exact: null);
    const stormy = Weather(code: 95, high: 28, low: 21, exact: null);

    test('取當天第一筆有天氣的支出', () {
      final days = reportTimeline(
        [
          expense(date: '2026-03-01', time: '09:00', weather: stormy),
          expense(date: '2026-03-01', time: '18:00', weather: sunny),
        ],
        'TWD',
        null,
      );

      expect(days[0].weather, same(stormy));
    });

    test('前面幾筆沒有天氣就往後找', () {
      final days = reportTimeline(
        [
          expense(date: '2026-03-01', time: '09:00'),
          expense(date: '2026-03-01', time: '18:00', weather: sunny),
        ],
        'TWD',
        null,
      );

      expect(days[0].weather, same(sunny));
    });

    test('整天都沒有就是 null，不是硬湊一個', () {
      final days = reportTimeline([expense(date: '2026-03-01')], 'TWD', null);

      expect(days[0].weather, isNull);
    });

    test('每一天各自算，不會沿用前一天的', () {
      final days = reportTimeline(
        [
          expense(date: '2026-03-01', weather: stormy),
          expense(date: '2026-03-02'),
        ],
        'TWD',
        null,
      );

      expect(days[0].weather, same(stormy));
      expect(days[1].weather, isNull);
    });
  });
```

**`reportTimeline` 的實際簽章要以檔案為準** —— 上面第三個參數是照網頁版的 `startDate` 推的，對不上就照實際的改。輔助函式 `expense(...)` 如果不支援 `weather` 具名參數，要先加上。

- [ ] **Step 2: 跑測試確認會失敗**

```powershell
flutter test test/report_timeline_test.dart
```

Expected: 新的四條紅。

- [ ] **Step 3: `ReportDay` 加欄位**

`lib/domain/report_timeline.dart`，`class ReportDay` 的 `final List<ReportEntry> entries;` 之前加：

```dart
  /// 當天的天氣，取**當天第一筆有天氣的支出**。整天都沒有就是 null。
  ///
  /// 掛在「天」不掛在「筆」：同一天三筆支出印三次一樣的天氣是噪音，
  /// 而且公開文件也小一點。
  ///
  /// 一天跨兩個城市時會顯示第一個 —— 這是已知且接受的不精確。替代方案
  /// （取眾數、列出全部）都讓規則沒辦法一句話講完，而報告是給不在場的人
  /// 看的，那個精度沒有意義。
  final Weather? weather;
```

建構子加 `this.weather`。

**`ReportEntry` 不動** —— 天氣掛在天，不掛在筆。

- [ ] **Step 4: 挑選規則**

`reportTimeline` 裡建立新的一天時 weather 給 null；每處理完一筆支出加：

```dart
      // 第一筆有天氣的說了算。「第一筆」的順序來自這個函式自己的排序，
      // 不是呼叫端傳進來的順序。
      if (day.weather == null && expense.weather != null) {
        day = day.copyWith(weather: expense.weather);
      }
```

**`ReportDay` 如果是 immutable（`final` 欄位、沒有 `copyWith`）**，改成在迴圈裡用可變的暫存結構收集，最後再建 `ReportDay` —— 以檔案實際的寫法為準。網頁版是可變的 map group，Dart 這邊可能不是。

- [ ] **Step 5: 跑測試確認通過**

```powershell
flutter test test/report_timeline_test.dart
```

- [ ] **Step 6: 序列化兩邊都加**

`lib/data/report_mappers.dart`：

讀（`_timeline` 裡的 `ReportDay(`）加：

```dart
          weather: _weatherFrom(item['weather']),
```

`_weatherFrom` 在 `mappers.dart` 是私有的，所以這個檔案要**自己寫一份**或把它改成公開。**選後者**：兩份一樣的解析遲早會分岔。把 `mappers.dart` 的 `_weatherFrom` 改名成 `weatherFrom` 並匯出。

寫（`'timeline': [` 那個 map）加：

```dart
          'weather': day.weather == null
              ? null
              : {
                  'code': day.weather!.code,
                  'high': day.weather!.high,
                  'low': day.weather!.low,
                  'exact': day.weather!.exact,
                },
```

- [ ] **Step 7: analyze 與測試**

```powershell
flutter analyze
flutter test
```

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/domain/report_timeline.dart flutter_app/test/report_timeline_test.dart flutter_app/lib/data/report_mappers.dart flutter_app/lib/data/mappers.dart
git commit -F - <<'MSG'
Make a report generated on the phone the same shape as one from the web

The timeline serialiser runs both ways, so leaving this out would mean
reports made on the phone silently lack a field reports made on the web
have -- one feature, two document shapes, with nothing on screen to
explain which you got.

Weather hangs off the day rather than the entry, matching the web:
printing the same icon three times for one day is noise, and the public
document stays smaller.

The day takes the first expense that has any. A day spanning two cities
shows the first city's, which is the accepted inaccuracy -- every
alternative costs the rule its one-sentence explanation.

The parsing helper becomes shared rather than copied into the report
mapper. Two identical parsers drift.
MSG
```

---

## Task 4: 表單

**Files:**
- Modify: `flutter_app/lib/ui/expense_form_page.dart`
- Create: `flutter_app/lib/ui/weather_chip.dart`

### 4.0 兩個網頁版踩過或差點踩到的坑

1. **編輯路徑不能洗掉天氣。** 載入既有支出時填入地點，如果順手觸發重查，那時離線就會把原本正確的天氣清成 null，存檔後就沒了 —— 而使用者只是改個備註。
2. **存檔的 `input` map 是手寫的欄位清單。** 漏掉 `weather` 就是靜默不存，**沒有任何型別檢查會抓到**。

- [ ] **Step 1: 建立 `weather_chip.dart`**

```dart
/// 天氣的圖示與溫度。四個位置共用。
///
/// 用 Material Icons 而不是自己畫 —— 這一輪剛把分類圖示從 emoji 換成
/// IconData，天氣照同一套。
library;

import 'package:flutter/material.dart';

import '../domain/models.dart';
import '../domain/weather.dart';
import 'theme.dart';

const Map<WeatherKind, IconData> _icons = {
  WeatherKind.clear: Icons.wb_sunny_outlined,
  WeatherKind.cloudy: Icons.wb_cloudy_outlined,
  WeatherKind.overcast: Icons.cloud_outlined,
  WeatherKind.fog: Icons.foggy,
  WeatherKind.drizzle: Icons.grain,
  WeatherKind.rain: Icons.water_drop_outlined,
  WeatherKind.snow: Icons.ac_unit,
  WeatherKind.thunder: Icons.thunderstorm_outlined,
};

class WeatherChip extends StatelessWidget {
  final Weather weather;
  final double size;

  const WeatherChip({super.key, required this.weather, this.size = 13});

  @override
  Widget build(BuildContext context) {
    final kind = weatherKind(weather.code);
    // 有 exact 就印單一溫度，沒有就印當日高低。這不只是格式差異 ——
    // 它讓畫面看得出這筆支出有沒有記時間。
    final label = weather.exact == null
        ? '${weather.low}–${weather.high}°'
        : '${weather.exact}°';

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(_icons[kind] ?? Icons.cloud_outlined, size: size + 3,
            color: AppColors.muted),
        const SizedBox(width: AppSpace.x1),
        Text(label, style: TextStyle(fontSize: size, color: AppColors.muted)),
      ],
    );
  }
}
```

**`Icons.foggy` 與 `Icons.thunderstorm_outlined` 在較舊的 Flutter 可能不存在。** analyze 報錯的話換成 `Icons.cloud_queue` 與 `Icons.flash_on`，不要為了圖示去升 SDK。

- [ ] **Step 2: 表單狀態**

`lib/ui/expense_form_page.dart` 的 state class，在 `ExpensePlace? _place;` 附近加：

```dart
  Weather? _weather;
  bool _weatherLoading = false;
```

- [ ] **Step 3: 查詢方法**

加一個方法：

```dart
  /// 地點與日期都有了就查天氣。
  ///
  /// **只在使用者改動地點或日期時呼叫，載入既有支出時不呼叫。**
  /// 載入時呼叫的話，離線編輯會查回 null 把原本正確的天氣清掉 ——
  /// 而使用者只是改個備註，畫面上完全看不出來發生過這件事。
  Future<void> _refreshWeather() async {
    // 先清空：改了就重查，查不到就沒有。停在那裡的舊天氣是「三月三號清邁
    // 的雨」配上「三月五號曼谷的晚餐」，跟未換算支出同一個立場 ——
    // 寧可沒有，不要錯的。
    setState(() {
      _weather = null;
      _weatherLoading = _place?.lat != null && _date.isNotEmpty;
    });
    if (!_weatherLoading) return;

    final found = await ref.read(weatherRepositoryProvider).lookup(
          place: _place,
          date: _date,
          time: _time,
        );
    if (!mounted) return;
    setState(() {
      _weather = found;
      _weatherLoading = false;
    });
  }
```

- [ ] **Step 4: 接上三個觸發點**

- 地點選好（第 703 行附近的 `onChanged: (value) => _place = value,`）→ 改成同時呼叫 `_refreshWeather()`
- 日期改變 → 呼叫
- 時間改變 → 呼叫

**載入既有支出（第 122 行 `_place = existing.place;`）不呼叫**，改成 `_weather = existing.weather;`。
**「再記一筆」（第 141 行 `_place = repeat.place;`）要呼叫** —— 那是新的一筆，日期是今天。

- [ ] **Step 5: 顯示**

地點欄位下方：

```dart
              if (_weatherLoading)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpace.x2),
                  child: Text('查天氣中...', style: text.bodySmall),
                )
              else if (_weather != null)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpace.x2),
                  child: WeatherChip(weather: _weather!),
                ),
```

- [ ] **Step 6: 存檔帶上**

第 287 行附近的 `input` map，`'place': ...` 那一段之後加：

```dart
        // 查不到就是 null —— 那時 onExpenseWeather 觸發器會在文件建立後
        // 補寫，所以離線記的帳最後還是會有天氣。
        'weather': _weather == null
            ? null
            : {
                'code': _weather!.code,
                'high': _weather!.high,
                'low': _weather!.low,
                'exact': _weather!.exact,
              },
```

- [ ] **Step 7: analyze 與測試**

```powershell
flutter analyze
flutter test
```

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/ui/weather_chip.dart flutter_app/lib/ui/expense_form_page.dart
git commit -F - <<'MSG'
Show the weather while the place is still on screen

The form asks once a place and a date are both present and asks again
whenever either changes, clearing first so a failed lookup leaves
nothing rather than yesterday's answer above today's dinner.

Opening an existing expense deliberately does not re-query. The web
version hit this: loading fires the same path, offline it returns null,
and saving then strips weather off an expense whose only edit was a
note. The load path seeds from the stored value instead.

Repeating an expense does re-query, because that one gets today's date.

The chip prints one temperature when the expense has a time and a range
when it does not, so the screen shows which kind of record it is rather
than inventing precision.
MSG
```

---

## Task 5: 列表、明細、報告

**Files:**
- Modify: `flutter_app/lib/ui/expense_row.dart`
- Modify: `flutter_app/lib/ui/expense_detail_page.dart`
- Modify: `flutter_app/lib/ui/report_page.dart`

- [ ] **Step 1: `expense_row.dart`**

這一輪的視覺改版剛加了 `_Clue` widget（圖示＋一行截斷文字）給地點與備註。天氣接在地點那條線索之後：

```dart
                  if (place != null)
                    Row(
                      children: [
                        Flexible(
                          child: _Clue(
                            icon: Icons.place_outlined,
                            label: place.name,
                          ),
                        ),
                        if (expense.weather != null) ...[
                          const SizedBox(width: AppSpace.x2),
                          WeatherChip(weather: expense.weather!, size: 11),
                        ],
                      ],
                    ),
```

**不另開一欄**：列上已經有分類圖示，再並排一個天氣圖示是兩個圖示搶注意力 —— 而天氣本來就屬於地點。

- [ ] **Step 2: `expense_detail_page.dart`**

地點區（`const _SectionTitle('地點')` 那一段）裡，地址之後加：

```dart
                  if (expense.weather != null) ...[
                    const SizedBox(height: AppSpace.x2),
                    WeatherChip(weather: expense.weather!),
                  ],
```

- [ ] **Step 3: `report_page.dart`**

第 399 行附近的 `'Day ${day.day} · ${_dayLabel(day.date)}'`，把它包成一個 Row：

```dart
                  Row(
                    children: [
                      Text(
                        'Day ${day.day} · ${_dayLabel(day.date)}',
                        // 原本的 style 照抄，不要改
                      ),
                      // 舊報告沒有這個欄位，一定要判斷而不是假設它存在。
                      if (day.weather != null) ...[
                        const SizedBox(width: AppSpace.x2),
                        WeatherChip(weather: day.weather!, size: 11),
                      ],
                    ],
                  ),
```

**原本那個 `Text` 的 style 與周圍結構照抄** —— 以檔案實際內容為準，不要順手改版面。

- [ ] **Step 4: analyze 與測試**

```powershell
flutter analyze
flutter test
```

- [ ] **Step 5: Commit**

```bash
git add flutter_app/lib/ui/expense_row.dart flutter_app/lib/ui/expense_detail_page.dart flutter_app/lib/ui/report_page.dart
git commit -F - <<'MSG'
Put the weather next to the place on the phone too

Same placement as the web: beside the place clue rather than in its own
column, because the row already carries a category icon and two icons
side by side split the glance -- and the weather is a fact about that
location anyway.

Older reports have no weather on their days, so the report header checks
rather than assumes.
MSG
```

---

## Task 6: 驗收

- [ ] **Step 1: 自動檢查**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd <repo>\flutter_app
dart format lib/ test/
flutter analyze
flutter test
```

- [ ] **Step 2: 掃描**

```bash
cd flutter_app
grep -rn "open-meteo\|archive-api" lib/       # 預期：無 —— 查詢只在 functions/
grep -c "weatherKind" lib/domain/weather.dart # 預期：1
grep -n "'weather'" lib/ui/expense_form_page.dart  # 預期：1（存檔的 map）
grep -n "weather" lib/data/report_mappers.dart     # 預期：讀與寫各一
```

**第一條最重要**：Flutter 出現 Open-Meteo 的網址就代表有人把查詢邏輯搬過來了，那正是這個設計要避免的三份實作。

- [ ] **Step 3: 走查 —— 記一筆有天氣的支出**

從搜尋清單選地點 → 出現「查天氣中...」→ 圖示與溫度。改日期會重查。填時間會從範圍變成單一溫度。

- [ ] **Step 4: 走查 —— 編輯不會洗掉天氣**

**這一條是 Task 4 §4.0 那個坑的驗收，一定要做。**

找一筆有天氣的支出 → **關掉網路** → 進編輯 → 只改備註 → 存檔 → 回列表確認**天氣還在**。

- [ ] **Step 5: 走查 —— 三種沒天氣的情況**

自己打字的地點、關網路記的新支出、日期填 1930 年。三種都要**存得下去而且沒有錯誤訊息**。

- [ ] **Step 6: 走查 —— 離線補寫**

關網路記一筆有座標地點的支出 → 開網路等同步 → 幾秒後列表上出現天氣。

- [ ] **Step 7: 走查 —— 兩邊的報告一致**

**從手機產生一份報告**，然後用網頁打開同一份 —— 日表頭要有天氣。這是這一輪存在的理由，一定要驗。

再打開一份改動前產生的舊報告，確認沒壞掉。

- [ ] **Step 8: Commit（若有修正）**

---

## Self-Review

**Spec coverage：**

| Spec §11 的項目 | 對應 Task |
|---|---|
| `Weather` 值物件、`Expense.weather` | Task 1 Step 5、6 |
| `domain/weather.dart` 與 8 條測試 | Task 1 |
| `data/mappers.dart` 的 `_weatherFrom` | Task 2 Step 1 |
| `report_mappers.dart` 讀與寫 | Task 3 Step 6 |
| `report_timeline.dart` 挑選規則 | Task 3 Step 3、4 |
| `weather_repository.dart` | Task 2 Step 2 |
| `weather_chip.dart` | Task 4 Step 1 |
| 四個顯示位置 | Task 4（表單）、Task 5（其餘三個） |
| 坑一：編輯不能洗掉天氣 | Task 4 §4.0、Step 4、Task 6 Step 4 |
| 坑二：存檔 map 要帶 weather | Task 4 §4.0、Step 6、Task 6 Step 2 |
| Material Icons 不畫 SVG | Task 4 Step 1 |
| 不重寫 Open-Meteo 邏輯 | Global Constraints、Task 6 Step 2 第一條掃描 |

**型別一致性：**

- `Weather{code, high, low, exact}` 在 Task 1 定義，Task 2、3、4、5 使用。欄位名跟 `functions/src/weather.ts` 的 `WeatherResult` 逐一相同。
- `weatherKind(int) → WeatherKind` 在 Task 1 定義，Task 4 Step 1 的 `WeatherChip` 使用。
- `WeatherRepository.lookup({place, date, time})` 在 Task 2 定義，Task 4 Step 3 使用 —— 具名參數一致。
- `WeatherChip({weather, size})` 在 Task 4 定義，Task 5 三處使用 `size: 11` 或預設。

**已知的不確定（實作時以檔案為準，不要照抄）：**

- Task 3 Step 1 的 `reportTimeline` 簽章第三個參數是照網頁版推的。
- Task 3 Step 4 假設 `ReportDay` 可以 `copyWith` 或迴圈裡用可變結構 —— Dart 版的實際寫法沒讀過。
- Task 4 Step 4 的三個觸發點行號是這一輪視覺改版**之後**的，而那些改動還沒編譯過，行號可能已經偏移。
- Task 5 Step 1 的 `_Clue` 是這一輪視覺改版剛加的，**還沒編譯過**。
- `Icons.foggy` / `Icons.thunderstorm_outlined` 的可用性要看 Flutter SDK 版本。
