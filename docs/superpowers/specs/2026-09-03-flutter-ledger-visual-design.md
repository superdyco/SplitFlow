# 手機版視覺改版：財務儀表 Design

**日期：** 2026-09-03
**範圍：** `flutter_app/lib/ui/` 全部畫面與共用 widget。`src/` 不碰。

## 1. 要解決的問題

上一輪（`2026-09-03-flutter-visual-alignment`）把網頁版的 token 抄了過來 —— 對比度、四階圓角、間距網格、字級。那一輪解決的是「兩個版本看起來不像同一個產品」。

**這一輪要解決的是另一件事：它沒有立場。**

現在的手機版對「這個 app 是什麼」沒有意見：

- 每一則內容都是一張獨立的卡，所以沒有任何一則比較重要
- 金額跟旁邊的說明文字一樣大，而且沒有對齊
- 只有 `figureStyle` 那一個地方用了等寬數字，其餘金額都是比例字型
- 密度平均，一屏看得到的東西比實際需要的少

而這個 app 每天真正被用到的動作只有兩個：**記一筆**，跟**我還欠誰多少**。兩件事都是看數字。

「財務儀表」的主張就是這一句：**數字優先，其餘讓路。**

設計稿：<https://claude.ai/code/artifact/bd80467a-8997-4540-aeab-d6cd0799b14b>（第一頁四張是採用的方向。稿子是 390×844 的手機框，內容照現有程式碼，數字是範例）。

## 2. 唯一的結構改動：任務頁的頁籤

**這是這一輪風險最高的一項，也是唯一動到資訊架構的一項。**

現在 `task_page.dart` 是三個頁籤：支出 / 成員 / 結算。

改成：

- 「我還要付誰多少」上頂成 `AppBar` 底下的摘要卡
- 頁籤收成兩個：支出 / 成員
- 完整結算面板降成獨立次頁，從摘要卡的「完整結算與付款紀錄 →」進去

**為什麼：** 這個 app 存在的理由是回答「我欠誰多少」，而它現在藏在第三個頁籤。網頁版上一輪已經做過同一件事（`ea6c1dc`、`dc28914`），設計稿畫的也是這個樣子。

**代價：** `settlement_tab.dart` 有 570 行，含付款記錄與確認流程。搬位置不改內部，但它從 `TabBarView` 的一頁變成一個 `Navigator.push` 的目的地，狀態怎麼帶要小心。

**如果要縮小這一輪的範圍，這一項是唯一該砍的。** 砍掉之後其餘全部仍然成立，只是任務頁跟設計稿不一樣。

## 3. Token 層（`theme.dart`）

改完全 app 自動受惠一半。

### 3.1 圓角整條下移一階

```dart
AppRadius.sm: 10.0 → 6.0    // chip、分段控制的內層、小標籤
AppRadius.md: 14.0 → 8.0    // 按鈕、輸入框
AppRadius.lg: 18.0 → 10.0   // 卡片（cardTheme 自動跟著）
AppRadius.xl: 22.0 → 14.0   // 對話框、bottom sheet
AppRadius.pill: 999.0       // 不變
```

**只改值，不改名，不改使用點。** 四階仍是四階，不會生出沒人用的常數。

`cardTheme` 已經是 `BorderRadius.circular(AppRadius.lg)`，所以全 app 的卡片圓角**一行就改完**。

### 3.2 新增兩個顏色

```dart
static const rowHead = Color(0xFFFAF8F5);  // 列表表頭條
static const rowLine = Color(0xFFECE6DE);  // 列表內的分隔線
```

`rowLine` 比既有的 `line` (#EDE7E0) 再深一點點，因為它現在要承擔原本靠陰影做的分隔工作 —— 卡片不再一張張浮起來，分隔就只剩這條線。

`rowHead` 上面會印 13px 標題，**必須進 `theme_contrast_test.dart`**（見 §7）。

### 3.3 按鈕最小高度 48 → 44

`filledButtonTheme` 與 `outlinedButtonTheme` 的 `minimumSize` 從 `Size(0, 48)` 改成 `Size(0, 44)`。

44 是 iOS 的建議下限，也過得了 WCAG 2.5.8。48 在密度提高之後顯得笨重。

**這是全 app 每一顆按鈕**，走查要專門看一輪有沒有變得難按 —— 特別是並排的兩顆。

### 3.4 等寬數字從一個常數變成一條規則

`theme.dart` 已經有 `figureStyle`（22px / w700 / `FontFeature.tabularFigures()`）。問題是它只有一個尺寸，所以其他地方的金額都沒有等寬數字。

改成一個工廠函式：

```dart
/// 畫面上每一個金額都要用這個。等寬數字讓一欄金額右對齊時位數對得齊 ——
/// 比例字型的 1 比 6 窄，一整欄下來小數點會是歪的。
TextStyle figure({double size = 22, FontWeight weight = FontWeight.w700, Color color = AppColors.ink});
```

保留 `figureStyle` 當作 `figure()` 的別名，既有 45 個使用點不用一次改完。

**規則：畫面上每一個金額都要走 `figure()`。沒有例外。**

### 3.5 字級不動

B 用到的 11 / 12 / 14 / 15 / 17 已經在現有的 `textTheme` 裡（`bodySmall` / `bodyMedium` / `titleMedium` / `titleSmall`）。不加也不減。

## 4. 新的共用 widget 詞彙

網頁版靠 CSS class 就能共用；Flutter 沒有這條路，所以要**開一個新檔案** `flutter_app/lib/ui/ledger.dart`，放四個 widget：

| Widget | 作用 |
|---|---|
| `LedgerCard` | 容器。card 底、`AppRadius.lg`、`line` 邊框、`clipBehavior: hardEdge`（讓內部的表頭條與分隔線切齊圓角） |
| `LedgerStrip` | 卡頂的表頭條。`rowHead` 底、13px/w600、左標題右總計 |
| `LedgerRow` | 一列。選用的圖示 + 標題 + 副標 + **固定寬度**的右側金額 |
| `LedgerDivider` | 1px `rowLine`，左邊縮排到內容起點 |

金額欄用**固定寬度**而不是 `Expanded` —— 欄寬固定，金額才真的對得齊。

`expense_form_page.dart` 上一輪加的私有 `_Card` widget 由 `LedgerCard` 取代，那份重複就此消掉。

### 4.1 卡片的角色改變

從「每一則內容一張卡」變成「**一組內容一個容器**」。

三張任務卡並排 → 一張 `LedgerCard`，裡面三個 `LedgerRow`，中間 `LedgerDivider`。這是密度提高的主要來源，也是「分隔線取代陰影」的具體長相。

### 4.2 金額排版的硬規則

1. 一律走 `figure()`
2. 在 `LedgerRow` 裡靠右，固定欄寬
3. 主要金額 15px / w600
4. 次要金額 12px / `AppColors.muted`
5. **在列表列裡，幣別代碼不跟金額同字級** —— 12px muted，或放進標籤

第 5 條只管列表列。頁面上唯一的主數字（總花費、我的分攤、每人平均）維持 `TWD 12,480` 連寫 —— 那裡只有一個數字，沒有要對齊的對象。

## 5. 分類圖示：emoji → Material Icons

現在是 `Text('${meta.icon} ${meta.label}')`，`meta.icon` 是 emoji 字串。

改成 `IconData`。理由：

- emoji 在不同 Android 版本與廠商 ROM 上長得不一樣，控制不了
- emoji 上不了色，跟「圖示用 `primaryDark`」這條規則衝突
- Material Icons 已經在 bundle 裡，不增加 APK 大小

`meta.icon` 的型別從 `String` 改成 `IconData`。**這會動到 domain 層**，是這一輪唯一碰 `lib/ui/` 以外的地方。網頁版仍然是 emoji —— 兩邊的分類圖示會不一樣，這是接受的代價（圖示不是身分色，不像顏色那樣必須一致）。

## 6. 每一頁

| 檔案 | 主要變更 |
|---|---|
| `task_list_page.dart` | hero 加一列三格的每趟小計；任務卡合併成 `LedgerCard` 多列；進行中/已封存加淺色分組標題 |
| `task_card.dart` | 從獨立卡片變成 `LedgerRow`；`shadow-raise` 拿掉（分隔線接手） |
| `task_page.dart` | §2 的結構改動；`AppBar` 收成標題＋副標一行；`TabBar` 換成分段控制 |
| `settlement_tab.dart` | 只搬位置成次頁，**內部完全不動** |
| `expense_form_page.dart` | 金額獨立成第一塊大字、幣別是右上角小按鈕、匯率與換算壓成一條；其餘欄位改 key-value 列；分類改 4 欄格子；底部固定列左邊顯示換算合計 |
| `report_page.dart` | 每人平均改大字並用 `primaryDark`；總花費/筆數/地點收成三格；「花在哪」五欄對齊；各區塊加 `LedgerStrip` |
| `expense_row.dart` | 圖示 + 名稱/副標 + 固定寬金額 |
| `expense_detail_page.dart` | 金額上頂成大字，其餘改 key-value 列 |
| `profile_page.dart` | 上一輪已分過組（`5857a86`），這輪每組改成 `LedgerCard` 多列，設定項目靠右顯示現值 |
| `explore_page.dart` / `favorites_page.dart` / `report_card.dart` | `ReportCard` 改成 `LedgerRow`：左名稱與天數人數、右每人平均 |
| `create_task_page.dart` / `join_task_page.dart` | 表單欄位改 key-value 列，跟支出表單同一套 |
| `sign_in_page.dart` / `onboarding_page.dart` | 只跟著 token 走，版面不動 —— 已經夠簡單 |
| `members_tab.dart` / `settlement_history.dart` / `category_chart.dart` / `payment_sheet.dart` / `confirm_dialog.dart` / `receipt_field.dart` / `place_field.dart` | 照 §4 的規則走 |

## 7. 對比度

沿用既有的硬規則：

- 文字一律 `muted` (4.9:1) 以上
- **`soft` (3.4:1) 不能印文字**
- 白字只印在 `primaryDark` 以上
- **錯誤訊息只能放白底** —— `danger` 對頁面底色只有 4.10:1，對白底才 4.66:1（上一輪 `theme_contrast_test.dart` 抓到的）

**新增 `rowHead` 之後要補測試**：`ink` 與 `muted` 對 `rowHead` 的比值都要進 `theme_contrast_test.dart`。#FAF8F5 幾乎是白的，預期會過，但要算過才寫。

## 8. 測試策略（誠實版）

跟上一輪一樣：**版面、密度、對齊、圓角，測試套件一個都看不到。**

能自動測的只有一件事，而它很重要：**對比度**。`theme_contrast_test.dart` 已經在了，新顏色補進去。

其餘靠：

- `flutter analyze` —— 維持基線 1 issue，不能變多
- `flutter test` —— 現有 391 條全綠（`rowHead` 的兩條進去之後是 393）
- 掃描：`meta.icon` 沒有殘留的 String 用法；`_Card` 已經刪掉
- **人工走查**，逐頁，要實機或模擬器

**不要用「測試全綠」當作版面改對了的證據。**

## 9. 不做的事

- **不動任何計算、資料流、Firestore 規則。**
- **不動文案。**
- **不動 `src/`。** 網頁版會因此落後 —— 兩邊的 token 是人工同步的，這輪之後 `styles.css` 的圓角與 `theme.dart` 對不上。這是接受的代價，要另立一輪補。
- **不動 `settlement_tab.dart` 的付款流程。** 只搬位置。
- **不加深色模式。**
- **不打包字型。** 維持系統字型。

## 10. 風險與分層

最大的風險是**一次改十幾個檔案加全域 token，壞掉之後很難二分**。

分層，每層獨立 commit、獨立可驗證：

1. **Token 層** —— `AppRadius` 五個值、兩個新顏色、按鈕高度、`figure()`。改完全 app 自動變化，這一步就要目視確認沒有爆版。
2. **`ledger.dart`** —— 四個新 widget，先寫出來、先用在一個地方驗證。
3. **分類圖示** —— `String` → `IconData`，會動到 domain，獨立一步。
4. **任務頁結構**（§2）—— 風險最高，但獨立且可回退。
5. **逐頁套用** —— 四頁有稿的先做，其餘後做。

前三步都是「改完立刻看得出對不對」的，所以排前面。

## 11. 驗收

- `flutter analyze` 維持 1 issue、`flutter test` 全綠
- `_Card` 與 emoji 分類圖示全專案搜不到
- 逐頁實機走查，重點：金額是否對齊成一欄、44px 按鈕是否還好按、分隔線是否**取代**了陰影而不是跟它疊加
- 鍵盤彈出時固定送出列的行為沒有壞掉（上一輪剛做的）
