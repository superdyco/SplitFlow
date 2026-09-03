# 支出天氣 Design

**日期：** 2026-09-03
**範圍：** `src/`（網頁版）、`functions/`、`firestore.rules`、`flutter_app/`（手機版）。

> **範圍變更（同日）**：原本寫「Flutter 這一輪不做」。改成做，理由見 §11 ——
> 報告的序列化是雙向的，Flutter 也會產生報告，不做的話**從手機產生的報告
> 沒有天氣、從網頁產生的有**，同一個功能兩種文件形狀。

## 1. 這是什麼

從 Google Places 選出來的地點帶著座標。支出本來就有日期、可能有時間。這三個東西湊起來足以查出「那天那個地點的天氣」，而那正是旅費報告缺的一塊：

> Day 3 · 3月3日 · 🌧 24–33° · 8,420

「那天下大雨」解釋了為什麼那天交通特別貴。報告是這個 app 唯一會被外人看到的一頁，而一份只有數字的報告說不出這件事。

**這是這個專案第一個跟錢無關的功能**，值得寫下來：現有每一個功能都在回答「多少錢、誰欠誰」，天氣回答的是「那天是什麼樣子」。它是回憶不是帳。做它的理由是報告頁，不是記帳流程。

## 2. 資料形狀

支出文件加一個**選填**欄位：

```ts
export interface ExpenseWeather {
  /** WMO 天氣代碼 0–99。決定圖示。 */
  code: number;
  /** 當日最高溫，攝氏整數。 */
  high: number;
  /** 當日最低溫，攝氏整數。 */
  low: number;
  /**
   * 那個小時的實測溫度，攝氏整數。**只有支出填了時間才有。**
   *
   * 有它就印「28°」，沒有就印「24–33°」—— 顯示形式直接反映這筆有沒有記
   * 時間，不假裝出沒有的精度。
   */
  exact: number | null;
}
```

**攝氏、整數、只有攝氏。** 不做華氏切換 —— 這個 app 的使用者在亞洲旅行，加一個單位設定就是加一個每個畫面都要問一次的問題。整數是因為 28.4° 跟 28° 對使用者沒有差別，而浮點數會在比較與序列化上找麻煩。

### `firestore.rules`

照 `validPlace()` / `validReceipt()` 既有的模式加一個獨立函式，**不放寬 `validExpenseShape()` 既有的任何一條**：

```
function validWeather() {
  let weather = request.resource.data.get("weather", null);
  return weather == null
    || (
      weather is map
      && weather.code is int
      && weather.code >= 0
      && weather.code <= 99
      && weather.high is int
      && weather.low is int
      && weather.high >= -90 && weather.high <= 60
      && weather.low >= -90 && weather.low <= 60
      && (
        weather.get("exact", null) == null
        || (weather.exact is int && weather.exact >= -90 && weather.exact <= 60)
      )
    );
}
```

**`exact` 那組括號不能省。** `A && B || C` 在規則語言裡跟在多數語言裡一樣解析成 `(A && B) || C` —— 少了括號，只要 `exact` 是合法整數，前面所有檢查就全部被短路掉，等於整條驗證失效。而它「看起來」是對的，測試也不會自己發現，所以規則的測試要包含一筆 `code` 非法但 `exact` 合法的資料。

然後在 `validExpenseShape()` 的鏈上加 `&& validWeather()`。

**client 可以寫這個欄位。** 它是表單預覽拿到的值，存檔時一起送上去。偽造天氣的風險可以忽略：那是裝飾，而且旅程成員是你認識的人。反過來禁止 client 寫的話，編輯支出時前端送回整份文件就會把它洗掉 —— 那是更容易發生也更難察覺的問題。

## 3. 天氣從哪裡來

**Open-Meteo。** 選它的決定性理由是**不需要 API 金鑰**。`.env.example` 對另外兩把金鑰寫了很長的警告（「用量計費，被別人撿去用會直接算你的帳單」），天氣這條完全繞開那個問題。它同時有預報與歷史資料，支援 CORS，免費額度對這個規模綽綽有餘。

### 兩個 endpoint

**已經實際打過 API 確認**（2026-09-03，曼谷座標）。兩個 endpoint 的涵蓋範圍是：

| endpoint | 涵蓋範圍 | 怎麼知道的 |
|---|---|---|
| `archive-api.open-meteo.com/v1/archive` | **1940-01-01 到今天** | 超出範圍時它自己回報：`out of allowed range from 1940-01-01 to 2026-09-03` |
| `api.open-meteo.com/v1/forecast` | **往回 93 天、往前 15 天** | 同上：`allowed range from 2026-06-02 to 2026-09-18` |

所以分流規則是一句話：**日期是今天或未來用 forecast，過去用 archive。**

**這跟直覺相反，值得寫下來為什麼**：archive 聽起來像是「舊資料」，但它其實**連今天都有真值**（查 2026-09-03 回傳 `weather_code: 61, max: 33.5, min: 25.6`），而且往回到 1940 年 —— 所以 forecast 那個 93 天的界線根本用不到，過去的日期一律走 archive 就好。

會用 forecast 只有兩個理由，都跟未來有關：

- **archive 拒絕未來日期**（明天就回 400）。使用者可以把日期填成未來。
- **今天用 forecast 拿到的是完整的一天**。archive 給的是「到目前為止」—— 早上八點記帳會拿到「今天最高 27°」，而那天其實會到 33°。今天是最常見的支出日期，值得為它多一個分支。

兩個 endpoint 的參數與回應形狀完全一樣，所以差別只在網址。

### 實際的參數與回應形狀（已驗證）

參數名是 **snake_case**：`weather_code`、`temperature_2m_max`、`temperature_2m_min`、`temperature_2m`。（舊文件裡的 `weathercode` 不要用。）

```json
{
  "timezone": "Asia/Bangkok",
  "daily":  { "time": ["2026-08-20"], "weather_code": [95],
              "temperature_2m_max": [29.6], "temperature_2m_min": [25.0] },
  "hourly": { "time": ["2026-08-20T00:00", "2026-08-20T01:00", ...],
              "temperature_2m": [26.1, 26.4, ...], "weather_code": [3, 3, ...] }
}
```

`hourly.time` 是**當地時間、沒有時區位移後綴**，所以直接拿支出的 `HH:MM` 去比對就對得上。archive 與 forecast 都支援 `hourly`。

**錯誤回應是 HTTP 400 加 JSON body**：`{"error": true, "reason": "..."}`。解析時要先看 `error` 欄位，不能只看 HTTP 狀態就丟例外 —— `reason` 是唯一講得出「為什麼這筆沒有天氣」的東西，值得記進日誌。

### `timezone=auto` 是正確性需求不是選項

支出的日期與時間是**當地時間** —— 使用者在曼谷輸入 19:05，指的是曼谷的 19:05。不帶這個參數 Open-Meteo 會回 UTC，那個 19:05 會變成當地的凌晨兩點，拿到的溫度是錯的日子的錯的時段。

這條要有測試釘住，因為它錯的時候畫面完全正常。

## 4. 誰去查：三個進入點

**Open-Meteo 的呼叫只寫在 `functions/` 一份。** `functions/` 與 `src/` 是兩個獨立套件、沒有共用程式碼，前端自己查的話網頁一份、Flutter 一份、離線補寫的 function 再一份 —— 同一段邏輯三份，分岔的症狀是「同一筆支出在手機和網頁顯示不同天氣」。

| 進入點 | 何時 | 做什麼 |
|---|---|---|
| `lookupWeather`（onCall） | 表單裡地點與日期都有了 | 回傳預覽值，前端顯示並在存檔時一起送出 |
| `onExpenseWeather`（onDocumentCreated） | 文件建立 | 有座標但沒有 weather 才查並補寫 |
| 舊支出 | — | **不回填。** 見 §8 |

觸發器只服務一種情況：**離線記的帳**。使用者當下沒訊號拿不到預覽，文件之後同步上去，觸發器那時才跑。這是把「沒訊號也能記」這個賣點延伸到天氣上的唯一辦法。

### 為什麼是獨立的觸發器

現有的 `onExpenseCreated` 把推播的所有步驟包在同一個 `try/catch` 裡。天氣塞進去的話，**Open-Meteo 掛掉會連帶讓推播不送出** —— 一個裝飾性功能拖垮一個功能性功能。

它還有一行 `if (targets.length === 0) return;`（單人任務不用通知任何人），天氣邏輯放在那行之後的話，**單人旅程永遠不會有天氣**。

分成兩個函式兩個問題都不存在，而且不用去動已經在跑的推播路徑。代價是每筆支出多一次函式呼叫。

### callable 要擋未登入

`lookupWeather` 不驗證呼叫者的話，它就是一個掛在你帳單上的公開天氣代理。只檢查 `request.auth != null` 就夠——不需要驗證他是不是那個任務的成員，因為天氣不是任何人的秘密。

## 5. 顯示

WMO 的 28 個代碼收成 **8 個圖示**：晴、多雲、陰、霧、毛毛雨、雨、雪、雷。純函式，有測試。

圖示畫成 inline SVG，不用 emoji —— 跟手機版那一輪把分類圖示從 emoji 換掉是同一個理由。

| 位置 | 做法 |
|---|---|
| 支出表單 | 地點與日期都有了才查。callable 有冷啟動，**要有讀取中的狀態**，不能突然跳出來 |
| 任務頁支出列表 | 掛在**地點那一行**。列上已經有分類圖示，再並排一個天氣圖示是兩個圖示搶注意力；而天氣本來就屬於地點 |
| 支出明細頁 | 跟地點、地圖同一區 |
| 旅費報告時間軸 | 掛在「天」的表頭 |

### 報告：掛在天，不掛在筆

同一天三筆支出印三次一樣的天氣是噪音。所以 `ReportDay` 加一個 weather，`ReportEntry` 不動 —— 公開文件也比較小。

**當天的天氣取「當天第一筆有天氣的支出」。** 規則要能一句話講完。一天跨兩個城市時會顯示第一個，這是已知且接受的不精確 —— 替代方案（取眾數、列出全部）都讓規則變得沒辦法一句話講完，而報告是給不在場的人看的，那個精度沒有意義。

`reportTimeline.ts` 的檔頭寫著「這是要放進公開文件的資料，所以只放時間、分類、地點與金額」。**天氣通過這個檢查**：地點名稱與日期本來就已經在公開文件裡了，那個地點那天下不下雨是公開事實，不多洩漏任何東西。

報告文件的規則沒有 shape 驗證（`allow create, update: if taskData(taskId).ownerId == request.auth.uid`），所以這一項不用改規則。**舊報告沒有這個欄位，顯示端要能接受它不存在。**

## 6. 改了日期或地點怎麼辦

**重查；查不到就清空，不留舊值。**

跟未換算支出同一個立場：寧可沒有，不要錯的。停在那裡的舊天氣是「三月三號清邁的雨」配上「三月五號曼谷的晚餐」，而畫面上看不出來。

## 7. 失敗是正常狀態

三種情況都直接不顯示，**不出現任何錯誤訊息**：

- 地點是自己打字的，沒有座標（跟地圖同一個限制，現成文案已經在講「只顯示有座標的支出」）
- Open-Meteo 掛掉或逾時
- 離線記的帳，等觸發器補

**絕對不能擋存檔。** 跟報告地圖同一條原則：「地圖是加分不是必要，拍不出來也照樣產得出報告」。表單的預覽要有逾時上限，不能讓使用者等一個查不到的天氣。

## 8. 不做的事

- **不回填舊支出。** 舊的就是沒有天氣，跟「自己打字的地點沒有座標」是同一種缺席。零風險、零額外工作。
- ~~**不做 Flutter。**~~ 見 §11。callable 共用這個決定仍然成立 ——
  Flutter 呼叫同一個雲端函式，**不重寫任何 Open-Meteo 的邏輯**。
- **推播不掛天氣。** `expenseNotification()` 只吃 taskName / author / expenseTitle / amount / currency，`message.ts` 完全不動。
- **不做華氏。**
- **不改任何金額計算、結算、分攤。**
- **不放寬 `validExpenseShape()` 既有的任何一條。**

## 9. 測試策略

這一輪**測得到的比上一輪多**，因為邏輯集中在 `functions/` 而不是畫面。

`functions/src/weather.ts` 全部是純函式，用既有的 vitest：

- 日期新舊決定 forecast 還是 archive —— 今天、明天、昨天三個邊界
- URL 組裝，特別是 `timezone=auto`
- 回應解析：有時間取那小時、沒時間取當日高低、欄位缺漏時回 null 而不是丟例外
- WMO 代碼 → 8 個圖示分組，含未知代碼的退路
- 報告「當天第一筆有天氣」的挑選規則（`reportTimeline.ts`，用 `src/` 的 vitest）

**測不到的**：四個畫面長什麼樣、冷啟動的實際延遲。

Open-Meteo 的真實回應形狀本來也在這一列，但**寫規格時已經實際打過了**（見 §3），所以解析是照著真實回應寫的，不是照記憶。那一輪也順手推翻了原本的分流方向 —— 這就是為什麼「先打一次再寫」值得。

## 10. 會動到的檔案

**新增**

| 檔案 | 責任 |
|---|---|
| `functions/src/weather.ts` | endpoint 選擇、URL 組裝、回應解析。純函式 |
| `functions/src/weather.test.ts` | 上面那些的測試 |
| `src/types/weather.ts` | `ExpenseWeather` 與 WMO → 圖示的分組 |
| `src/components/expense/WeatherChip.vue` | 圖示＋溫度。四個位置共用 |

**修改**

| 檔案 | 變更 |
|---|---|
| `functions/src/index.ts` | 加 `lookupWeather`（onCall）與 `onExpenseWeather`（onDocumentCreated） |
| `firestore.rules` | 加 `validWeather()`，掛進 `validExpenseShape()` |
| `src/types/expense.ts` | `Expense` 加選填 `weather` |
| `src/pages/ExpenseFormPage.vue` | 地點與日期都有了就取預覽 |
| `src/components/expense/ExpenseRow.vue` | 天氣掛在地點那一行 |
| `src/pages/ExpenseDetailPage.vue` | 地點區加天氣 |
| `src/utils/reportTimeline.ts` | `ReportDay` 加 weather 與挑選規則 |
| `src/pages/ReportPage.vue` | 時間軸的日表頭顯示天氣 |
| `src/composables/useTripReport.ts` | 產生報告時帶上天氣 |

**不動**：`functions/src/message.ts`、任何金額或結算相關的檔案、`flutter_app/`。

## 11. 手機版

### 為什麼不能留到下一輪

`data/report_mappers.dart` 的時間軸序列化是**雙向**的：Flutter 讀報告，也產生報告。

Flutter 不做的話，**從手機按「產生報告」出來的文件沒有天氣，從網頁按的有**。同一個功能產出兩種形狀的公開文件，而使用者完全看不出來差別在哪 —— 他只會覺得「有時候有天氣有時候沒有」。

### 不重寫的東西

**Open-Meteo 的邏輯一行都不搬到 Dart。** endpoint 分流、URL 組裝、回應解析、`timezone=auto`、錯誤處理，全部留在 `functions/src/weather.ts`。Flutter 呼叫同一個 `lookupWeather` callable，拿到的是算好的結果。

這正是 §4 那個決定的回報：如果當初讓前端自己查，現在就要用 Dart 再寫一次，而兩份實作分岔的症狀是「同一筆支出在手機和網頁顯示不同天氣」。

`cloud_functions` 套件已經在依賴裡（`deleteAccount` 用的），region 一樣是 `asia-east1`。

### 要寫的東西

| 檔案 | 變更 |
|---|---|
| `domain/models.dart` | 加 `Weather` 值物件，`Expense` 加選填 `weather` |
| `domain/weather.dart`（新） | `WeatherKind` 與 `weatherKind(code)`。**照抄網頁版的分組與那 8 條測試** |
| `data/mappers.dart` | `_weatherFrom` —— 比照既有的 `_placeFrom` |
| `data/report_mappers.dart` | `ReportDay` 的**讀與寫都要**加 weather |
| `domain/report_timeline.dart` | `ReportDay` 加 weather 與「當天第一筆」的挑選規則 |
| `data/weather_repository.dart`（新） | 呼叫 callable。查不到回 null |
| `ui/weather_chip.dart`（新） | 圖示＋溫度 |
| `ui/expense_form_page.dart` | 地點與日期都有了就查；**存檔的 map 要帶上** |
| `ui/expense_row.dart` | 掛在地點那條線索行 |
| `ui/expense_detail_page.dart` | 地點區 |
| `ui/report_page.dart` | 時間軸的日表頭 |

### 跟網頁版一樣要小心的兩件事

1. **編輯路徑不能洗掉天氣。** 網頁版踩過這個坑：載入舊支出時填入地點會觸發重查，那時如果離線就把原本正確的天氣清成 null，存檔後就沒了 —— 而使用者只是改個備註。Flutter 的表單是 `setState` 不是 watcher，但同一個陷阱要一起想過。

2. **存檔的 map 要帶 `weather`。** `expense_form_page.dart` 的 `input` 是**手寫的欄位清單**，漏掉就是靜默不存 —— 沒有任何型別檢查會抓到。

### 圖示用 Material Icons

網頁版畫 inline SVG 是因為它沒有圖示庫。Flutter 有 Material Icons，而且這一輪剛把分類圖示從 emoji 換成 `IconData` —— 天氣照同一套，不畫 SVG。
