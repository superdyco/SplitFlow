# SplitFlow · Flutter 版（進行中）

網頁版的移植。**目前只有領域邏輯這一層，而且還沒有編譯過。**

## ⚠️ 現在的狀態

寫這些檔案的時候，這台機器上**沒有安裝 Flutter / Dart SDK**，所以：

- 沒有 `flutter create` 產生的平台資料夾（`android/`、`ios/`、`web/`…）
- 沒有 `pubspec.lock`
- **這裡的 Dart 程式碼一行都沒有編譯過，測試也一次都沒跑過**

把它當成「已經想清楚、但還沒驗證」的草稿。第一件事一定是讓它跑起來，
而不是繼續往上加東西。

## 接手時的第一步

```bash
winget install --id=Google.Flutter    # 或自己下載 SDK
cd flutter_app
flutter create .                      # 補上平台資料夾，不會蓋掉 lib/ 與 test/
flutter pub get
flutter test                          # ← 這一步才是真正的驗收
```

`flutter test` 全綠之前，不要動 UI。理由在下一節。

## 為什麼先搬這一層

網頁版的程式碼大致是這樣分佈的：

| 類別 | 行數 | 移植成本 |
| --- | --- | --- |
| Firestore 規則 + 規則測試 | 2,037 | **完全不用動**（規則在伺服器端） |
| 純邏輯（分攤、結算、換匯…） | 2,103 | 機械翻譯 |
| 單元測試 | 2,682 | 跟著純邏輯一起翻 |
| 服務層 | 1,784 | FlutterFire 的 API 幾乎 1:1 |
| 狀態管理 | 822 | 重寫，量小 |
| 畫面 | 5,734 | 整個重寫 |

真正難的東西 —— 餘數怎麼分、最少轉帳次數、多幣別鎖匯率 —— 全在「純邏輯」
那一格，而且它可以在**沒有畫面、沒有 Firebase、沒有裝置**的情況下驗證。
先把它搬完並跑綠，後面的 UI 就只是把已知正確的數字畫出來。

反過來先做畫面的話，等到算錯錢才會發現，而那時候分不清是移植錯了還是
畫錯了。

## 已經搬過來的

```
lib/domain/
  currency.dart     ← src/utils/currency.ts
  models.dart       ← src/types/ 裡結算會用到的部分
  settlement.dart   ← src/utils/settlement.ts
test/
  currency_test.dart    ← tests/currency.test.ts
  settlement_test.dart  ← tests/settlement.test.ts
```

測試案例是**一比一搬過來的，不是重寫的**。兩邊跑出來只要有一個對不上，
就是移植出了問題，而不是「本來就在測不同的東西」。

## 移植時特別小心的三個地方

**1. `List.sort` 在 Dart 不保證穩定，JS 的 `Array.sort` 保證。**
`allocate` 與 `_buildTransfers` 的比較子都補了「平手時比索引／比 uid」。
少了它，同一筆帳在兩個版本上，那一塊錢會落在不同的人身上。

**2. `Math.round` 與 `double.round()` 對負數的行為不同。**
JS 往正無窮（-0.5 → -0），Dart 往遠離零（-0.5 → -1）。目前金額一律為正，
兩邊一致；哪天出現負數金額要記得這件事。

**3. 千分位沒有照抄那段零寬度前瞻的正則。**
改成明寫的迴圈。不是 Dart 不支援，而是寫的當下沒有 SDK 可以驗 ——
沒得測的時候，選看一眼就知道對不對的寫法。

## 還沒決定的事

網頁版的 `/r/:taskId/:reportId` 公開報告連結，**原生 App 接不住** ——
那條連結的價值就在於「沒有帳號的人點了就看得到」。目前傾向是原生 App 只做
記帳，公開報告與探索頁留在現有的網頁版。這件事在往下做之前要先定案，
因為它會決定要不要編 Flutter Web。
