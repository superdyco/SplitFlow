# SplitFlow · Flutter 版（進行中）

網頁版的移植。**記帳這條主線已經可以用了**，在模擬器上跑過真實資料。

## 現在的狀態

`dart test` 166 項全過、`dart analyze` 乾淨，debug APK 裝在模擬器上驗過。

跑得起來的：登入、任務列表、建立任務、支出列表與新增／編輯支出、
成員管理（升降權限、移除）、結算與付款記錄／確認、個人設定。

驗證方式是拿正式資料庫裡的越南任務（15 人、100 筆支出、含既有付款）
在模擬器上實際操作 —— 不是只看畫面長出來，而是每個寫入都做完一次來回：
升權限再降回去、記一筆付款再確認再刪掉，看結算金額有沒有跟著動、
動完之後資料有沒有回到原狀。

⚠️ 測試涵蓋率要講清楚：166 項**全部是純函式與文件轉換**。
repository 那一層（真的打 Firestore 的）沒有自動化測試，靠的是上面那種
手動來回。

## 開發環境

**都不在 PATH 裡**，每個 shell 要先設一次：

```bash
export ANDROID_HOME=/c/dev/android-sdk
export PATH="/c/dev/flutter/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

| | 位置 | 版本 |
| --- | --- | --- |
| Flutter | `C:devlutter` | 3.47.1 / Dart 3.13.1 |
| Android SDK | `C:devandroid-sdk` | platform 36、build-tools 36.0.0、NDK 28.2 |
| 模擬器 AVD | `splitflow` | android-36 google_apis x86_64 |

用命令列工具裝的，不是 Android Studio —— 整個過程可以自動化，不用點 GUI 精靈。

### ⚠️ Android CLI 的套件路徑有兩種格式，而且互相衝突

新版把 `平台;版本` 改成 `平台/版本`，但**改得不徹底**：

| 工具 | 要的格式 | 從哪裡呼叫 |
| --- | --- | --- |
| `sdkmanager` | `platforms/android-36` | bash 就行 |
| `avdmanager` | `system-images;android-36;...` | **必須用 PowerShell** |

因為 `;` 在 Windows 的 `.bat` 裡是參數分隔符，從 bash 傳過去會被切掉，
錯誤訊息是「Package 36.0.0 not found」這種看不出原因的東西。

**Gradle 自己也踩這個坑**：它想自動裝 NDK 時用的是舊格式，所以會失敗成
`NTSTATUS 0xC0000409`。解法是先手動裝好：

```bash
sdkmanager.bat --sdk_root=C:/dev/android-sdk "ndk/28.2.13676358"
```

## 跑測試

```bash
cd flutter_app && flutter pub get && dart test
```

## 跑起來

```bash
emulator.exe -avd splitflow -no-snapshot-load -gpu swiftshader_indirect &
flutter run
```

Google 登入需要 debug 憑證的 SHA-1 註冊在 Firebase，**已經設好了**
（`76:EE:77:...`）。換一台機器開發的話要重做一次：

```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
npx firebase apps:android:sha:create <androidAppId> <sha1> --project splitflow-e39c0
rm android/app/google-services.json
npx firebase apps:sdkconfig ANDROID <androidAppId> --out android/app/google-services.json
```

沒做的話登入會失敗成 `ApiException: 10`（DEVELOPER_ERROR），
訊息完全看不出跟憑證有關。

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

## 還沒搬的

| | 網頁版位置 | 為什麼還沒動 |
| --- | --- | --- |
| 收據拍照 | `src/components/expense/ReceiptField.vue` | 不是移植是重寫：相機、壓縮、Storage 上傳，原生的做法跟網頁完全不同。`receipt_policy.dart` 已經先搬好了 |
| 地點搜尋 | `src/services/placeService.ts` | Places API 的 REST 呼叫，`place_bias.dart` 已經先搬好了 |
| 加入邀請 | `src/pages/JoinPage.vue` | 建議留在網頁版：邀請連結的價值在於「點了就進得去」，跟公開報告是同一個道理。`joinTask` 在 repository 裡寫好了，哪天要接不用重寫 |

編輯支出時**不會動到收據**：更新只送有列出來的欄位，Firestore 保留其餘的，
所以網頁版傳上去的收據不會被原生版洗掉。這是刻意的，不是還沒做。

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
