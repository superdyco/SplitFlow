# SplitFlow · Flutter 版（進行中）

網頁版的移植。**目前只有領域邏輯這一層，而且還沒有編譯過。**

## 現在的狀態

**純邏輯層 + 資料存取層已寫完：`dart test` 151 項全過、`dart analyze` 乾淨。**

⚠️ 但要講清楚**測試涵蓋到哪裡**：151 項全部是純函式與文件轉換。
repository 那一層（真的打 Firestore 的部分）**一行都還沒被執行過** ——
這台機器上沒有模擬器也沒有實機，`flutter run` 跑不起來。

平台資料夾、Firebase 註冊、`firebase_options.dart` 都齊了，缺的只是一個
跑得起來的裝置。

還沒有的東西：

- 平台資料夾（`android/`、`ios/`…）—— 需要時跑 `flutter create .` 補上，
  不會蓋掉 `lib/` 與 `test/`
- 資料存取層（Firestore）、狀態管理、任何畫面

## 跑測試

```bash
cd flutter_app
flutter pub get
dart test
```

SDK 裝在 `C:devlutter`（Flutter 3.47.1 / Dart 3.13.1），不在 PATH 裡，
所以要嘛把 `C:devlutterin` 加進 PATH，要嘛在指令前面設一次。

領域層的測試用純 Dart 的 `package:test`，不需要 widget 環境。這讓
「`lib/domain/` 不准 import Flutter」變成編譯器會抓的事，而不是靠自律。

**在測試全綠的前提下才往上加東西。** 理由在下一節。

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
  currency.dart         ← src/utils/currency.ts
  models.dart           ← src/types/expense.ts、payment.ts、settlement.ts
  settlement.dart       ← src/utils/settlement.ts
  my_cost.dart          ← src/utils/myCost.ts
  task_status.dart      ← src/utils/taskStatus.ts + taskRole.ts
  expense_date.dart     ← src/utils/expenseDate.ts
  expense_groups.dart   ← src/utils/expenseGroups.ts
  category_totals.dart  ← src/utils/categoryTotals.ts
  expense_actions.dart  ← src/utils/repeatExpense.ts + memberRemoval.ts
  settlement_text.dart  ← src/utils/settlementText.ts
  auth_error.dart       ← src/utils/authError.ts
  receipt_policy.dart   ← src/utils/receiptPolicy.ts
  place_bias.dart       ← src/utils/placeBias.ts
  validation.dart       ← src/utils/firestore.ts 的驗證函式
  offline_write.dart    ← src/utils/offlineWrite.ts
lib/data/
  mappers.dart          ← expenseService.ts 的 normalizeExpense 等
  firestore_refs.dart   ← 集中所有 Firestore 路徑
  task_repository.dart  ← taskService.ts + memberService.ts
  expense_repository.dart ← expenseService.ts + paymentService.ts
  auth_repository.dart  ← authService.ts + userService.ts
test/                   （151 項，全過）
```

**測試涵蓋率不平均，而且是刻意的。** `lib/domain/` 與 `mappers.dart`
測得很密（那裡是算錢與吞舊資料的地方）；repository 一項都沒有，因為那需要
模擬器或實機。等有裝置之後，這個 repo 已經有 Firestore 模擬器的設定
（根目錄 `firebase.json`），現有的 137 條安全規則測試也是跑在同一個模擬器上。

**記帳需要的純邏輯到此搬完。** 網頁版剩下沒搬的，理由都在下一節。

測試案例是**一比一搬過來的，不是重寫的**。兩邊跑出來只要有一個對不上，
就是移植出了問題，而不是「本來就在測不同的東西」。

其中兩條是**不變條件**而不是個案，六種情境（均分、除不盡、自訂、外幣、
含付款、15 人）都要成立：

- 每個人的 balance 加總是 0 —— 錢不會憑空出現或消失
- 建議轉帳的金額加總等於應付總額

個案會隨產品改，這兩條不會。破了就是算錯錢。

## 刻意不搬的

**報告相關**（`placeTotals`、`tripSummary`、`reportTimeline`、`reportPlaces`、
`favorites`）—— 公開報告與探索頁留在網頁版，見上面的範圍決定。

**網頁平台專屬**（`platform`、`visibility`、`storageProbe`、`perfTrace`、
`stallGuard`）—— 這些是 2026-08-24 那次效能調查留下的工具，而那個 30 秒卡頓
是 WebKit 特有的（桌機 0/13 次、iPhone 7/69 次）。原生的 Firestore 不走
WebChannel，這組東西在這裡沒有對應的問題要解。

**需要重寫而不是移植**（`imageCompress` 用 canvas）—— 原生要換成 Dart 的
影像套件。

（`offlineWrite` 本來也在這一組，查過之後發現判斷錯了：FlutterFire 的寫入
Future 跟 JS SDK 一樣，離線時不會完成，所以那支直接移植就對了。已搬。）

**錯誤格式化**（`firestore.ts` 的 `firebaseErrorMessage`）—— 它要認 Firestore
的錯誤碼，屬於資料存取層，而且原生的錯誤形狀跟 JS SDK 不一樣。只搬了同一個
檔案裡跟 Firebase 無關的驗證函式。

## 移植時處理掉的平台差異

除了前面三條，這一批又多兩個：

**4. Firebase 的錯誤碼有兩種寫法。** JS SDK 給 `auth/popup-closed-by-user`，
FlutterFire 給 `popup-closed-by-user`。`normalizeAuthCode` 統一剝掉前綴，
呼叫端不用管自己拿到的是哪一種，測試兩種都釘住。

**5. `enabledProviders` 在原生版可能要改。** 目前跟網頁版一樣只開 Google，
但 iOS 上架時 Apple 會要求提供 Apple 登入。真的要送 App Store 時記得回來看。

## 還沒開始的

| | 網頁版位置 | 備註 |
| --- | --- | --- |
| 資料存取 | `src/services/` | FlutterFire 的 API 幾乎 1:1 |
| 狀態管理 | `src/composables/`、`src/stores/` | 改成 Riverpod |
| 畫面 | `src/pages/`、`src/components/` | 整個重寫，量最大的一塊 |

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

## 範圍：原生只做記帳（2026-08-26 定案）

網頁版的 `/r/:taskId/:reportId` 公開報告連結，**原生 App 不接**。

那條連結的全部價值就在於「沒有帳號的人點了就看得到」，而原生 App 給不了
這件事。所以分工是：

| | 在哪裡 |
| --- | --- |
| 記帳、支出、成員、結算 | Flutter 原生 |
| 公開報告 `/r/...`、探索、收藏 | **留在現有網頁版** |

好處是這個 Flutter 專案不用編 Web、不用管 SEO 與連結預覽，可以專心做
「手機上記帳」這件它真正贏的事 —— 而那也正是量測顯示網頁版最吃虧的地方
（30 秒卡頓是 WebKit 特有的，桌機 0/13 次、iPhone 7/69 次）。

代價是兩套 codebase 共存。共用的是 Firestore 的資料模型與安全規則，
那兩樣**一行都不用改**，也是為什麼領域邏輯要先搬、而且要跟網頁版一比一對齊。
