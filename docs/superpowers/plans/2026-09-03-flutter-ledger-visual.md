# 手機版視覺改版：財務儀表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把手機版從「每一則內容一張浮起來的卡」改成「一組內容一個容器、金額對齊成一欄」的財務儀表風格，並把結算從第三個頁籤搬到任務頁頂部。

**Architecture:** 由下而上五層，每層改完立刻看得出對不對：token（`theme.dart`）→ 共用 widget（新檔 `ledger.dart`）→ 分類圖示（動到 domain）→ 任務頁結構 → 逐頁套用。風險最高的三層排在最前面，錯了第一步就會發現，而不是改到第九頁才知道每頁都要重來。

**Tech Stack:** Flutter / Dart，Material 3，Riverpod。測試用 `flutter test`（`package:test` 與 `package:flutter_test` 混用，兩者都跑得起來）。靜態檢查 `flutter analyze`。

**Spec:** `docs/superpowers/specs/2026-09-03-flutter-ledger-visual-design.md`

## Global Constraints

- **只動 `flutter_app/`。`src/` 完全不碰。** 網頁版會因此落後，這是接受的代價。
- **不動任何計算、資料流、Firestore 規則、路由以外的導覽邏輯。** 純視覺，唯一例外是 Task 4 的結算頁籤搬家。
- **不動文案。** 一個字都不改。
- **不動 `settlement_tab.dart` 的內部。** 570 行含付款記錄與確認流程，Task 4 只搬它的位置。
- **不加深色模式，不打包字型。**
- **中文註解，寫「為什麼」不寫「做了什麼」。** 跟著既有風格。
- **這個 repo 的工作區檔案是 CRLF 行尾。** 用腳本做字串比對取代時，樣板字串的換行對不上檔案裡的換行，比對會**靜默失敗**。先偵測行尾再組樣板，或直接用編輯工具。
- **這台開發機沒有 Dart / Flutter。** `flutter analyze` 與 `flutter test` 必須在有 Flutter 的機器上跑。**沒跑過就不准打勾，也不准在 commit message 裡宣稱測試過。**
- **測試套件看不到版面。** 密度、對齊、圓角一個都測不到。唯一自動測得到的是對比度與 `ledger.dart` 的欄寬。不要用「測試全綠」當作版面改對了的證據。

### 基線（每個 Task 結束都要回到這裡）

```
flutter analyze   → 1 issue（基線，不是 0）
flutter test      → 391 passed
```

Task 1 之後變成 **393 passed**（新增兩條對比度斷言）。
Task 2 之後變成 **397 passed**（新增四條 widget test）。

### 既有型別與常數（全計畫共用，不要重新定義）

`flutter_app/lib/ui/theme.dart`：

```dart
abstract final class AppColors {
  static const bg = Color(0xFFF2F0EC);
  static const surface = Color(0xFFFBFAF8);
  static const card = Color(0xFFFFFFFF);
  static const ink = Color(0xFF1A1613);
  static const muted = Color(0xFF6F665E);   // 4.9:1 on bg。所有次要文字。
  static const soft = Color(0xFF8A8078);    // 3.4:1。不能印文字。
  static const line = Color(0xFFEDE7E0);
  static const lineStrong = Color(0xFFE2DCD4);
  static const primary = Color(0xFFE8590C);      // 只當裝飾底
  static const primaryDark = Color(0xFFC2410C);  // 白字 5.2:1、當文字 4.6:1
  static const primaryDeep = Color(0xFF9A3412);
  static const primarySoft = Color(0xFFFFF0E4);
  static const primaryB1 = Color(0xFFE8590C);
  static const primaryB2 = Color(0xFFF0A072);
  static const primaryB3 = Color(0xFFF7D3BD);
  static const track = Color(0xFFF0EBE4);
  static const danger = Color(0xFFD63939);       // 只能放白底
  static const dangerLine = Color(0xFFF3D2CE);
  static const dangerSoft = Color(0xFFFFF5F5);
  static const dangerQuiet = Color(0xFFB8837C);
  static const success = Color(0xFF0E9F6E);
  static const successSoft = Color(0xFFE6F6EF);
  static const skeleton = Color(0xFFEFEAE3);
  static const skeletonHi = Color(0xFFF7F3EE);
}

abstract final class AppSpace {
  static const text = 2.0;
  static const x1 = 4.0;
  static const x2 = 8.0;
  static const x3 = 12.0;
  static const x4 = 16.0;
  static const x6 = 24.0;
  static const x8 = 32.0;
}
```

`flutter_app/lib/domain/models.dart`：

```dart
enum ExpenseCategory { food, transport, stay, ticket, shopping, other }

class CategoryMeta {
  final ExpenseCategory value;
  final String label;
  final String icon;          // ← Task 3 把它改成 IconData
  const CategoryMeta(this.value, this.label, this.icon);
}

CategoryMeta categoryMeta(ExpenseCategory value);
```

`flutter_app/test/theme_contrast_test.dart` 已有的工具（不要重寫）：

```dart
double contrastRatio(Color a, Color b);   // WCAG 2.1
```

---

## File Structure

**新增**

| 檔案 | 責任 |
|---|---|
| `flutter_app/lib/ui/ledger.dart` | 卡片／表頭條／列／分隔線四個 widget。全 app 的列表長相都從這裡來。 |
| `flutter_app/test/ledger_test.dart` | `ledger.dart` 的 widget test。測得到的只有欄寬與字型特性，就只測那些。 |
| `flutter_app/lib/ui/settlement_page.dart` | Task 4：結算從頁籤變成的獨立次頁。只是 `settlement_tab.dart` 的外殼。 |

**修改**

| 檔案 | 變更 |
|---|---|
| `flutter_app/lib/ui/theme.dart` | 圓角五個值、兩個新顏色、按鈕高度、`figureStyle` → `figure()` |
| `flutter_app/test/theme_contrast_test.dart` | 補 `rowHead` 兩條斷言 |
| `flutter_app/lib/domain/models.dart` | `CategoryMeta.icon`：`String` → `IconData` |
| `flutter_app/lib/ui/task_page.dart` | 結算上頂、頁籤收二、AppBar 收成一行 |
| `flutter_app/lib/ui/task_list_page.dart` | hero 三格小計、任務卡合併成一張 |
| `flutter_app/lib/ui/task_card.dart` | 獨立卡片 → `LedgerRow` |
| `flutter_app/lib/ui/expense_form_page.dart` | 金額上頂、key-value 列、分類格子、`_Card` 刪除 |
| `flutter_app/lib/ui/report_page.dart` | 大字、三格、五欄對齊、`LedgerStrip` |
| `flutter_app/lib/ui/expense_row.dart` | 圖示＋名稱／副標＋固定寬金額 |
| `flutter_app/lib/ui/expense_detail_page.dart` | 金額上頂、key-value 列 |
| `flutter_app/lib/ui/profile_page.dart` | 每組改 `LedgerCard` 多列 |
| `flutter_app/lib/ui/report_card.dart` | → `LedgerRow` |
| `flutter_app/lib/ui/explore_page.dart`、`favorites_page.dart` | 套用新的 `ReportCard` |
| `flutter_app/lib/ui/create_task_page.dart`、`join_task_page.dart` | 表單改 key-value 列 |
| `flutter_app/lib/ui/category_chart.dart` | 分類圖示、五欄對齊 |
| `flutter_app/lib/ui/members_tab.dart`、`settlement_history.dart`、`payment_sheet.dart`、`confirm_dialog.dart`、`receipt_field.dart`、`place_field.dart` | 照 `ledger.dart` 的規則 |

**不動**：`sign_in_page.dart`、`onboarding_page.dart`（只跟著 token 走）、`settlement_tab.dart` 內部、`place_map.dart`、`diagnostics_section.dart`。

---

## Task 1: Token 層

**Files:**
- Modify: `flutter_app/lib/ui/theme.dart`
- Modify: `flutter_app/lib/ui/settlement_tab.dart:213`、`task_card.dart:111`、`task_list_page.dart:371`
- Test: `flutter_app/test/theme_contrast_test.dart`

**Interfaces:**
- Produces：`AppColors.rowHead`、`AppColors.rowLine`、`figure({size, weight, color})`。Task 2 之後每一個 Task 都會用到。
- Produces：`AppRadius` 的新值 —— 使用點不變，所以其他 Task 不需要知道。

### 1.1 為什麼先做這一步

`cardTheme` 已經是 `BorderRadius.circular(AppRadius.lg)`，所以改一個數字，全 app 的卡片圓角同時變。這是整個計畫裡投報率最高的一步，也是最容易看出「有沒有東西爆版」的一步。

- [ ] **Step 1: 先寫會失敗的對比度測試**

在 `flutter_app/test/theme_contrast_test.dart` 裡，找到既有的 `group('contrastRatio 本身', ...)` 之後的第一個顏色 group，在它前面插入：

```dart
  group('rowHead —— 列表表頭條', () {
    /*
      表頭條上面印的是 13px 的區段標題，那是內文不是裝飾，門檻 4.5:1。

      #FAF8F5 幾乎是白的，這兩條預期會過。還是要寫：預期會過跟算過是兩件事，
      而下一個人改這個顏色的時候，需要有東西攔住他。
    */
    test('ink 印在 rowHead 上過得了 AA', () {
      expect(
        contrastRatio(AppColors.ink, AppColors.rowHead),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('muted 印在 rowHead 上過得了 AA', () {
      expect(
        contrastRatio(AppColors.muted, AppColors.rowHead),
        greaterThanOrEqualTo(4.5),
      );
    });
  });
```

- [ ] **Step 2: 跑測試，確認紅的是「沒有這個顏色」不是「對比度不夠」**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd <repo>\flutter_app
flutter test test/theme_contrast_test.dart
```

Expected: **編譯失敗**，訊息是 `The getter 'rowHead' isn't defined for the class 'AppColors'`。

如果是別的錯誤，先修那個，不要往下走。

- [ ] **Step 3: 補兩個顏色**

`theme.dart`，在 `static const track = Color(0xFFF0EBE4);` 那一段之後插入：

```dart
  /*
    列表的兩個新顏色。卡片不再一張張浮起來之後，「這是兩件事」就只剩
    這兩個東西在講：頂上的一條底色，跟中間的一條線。

    rowLine 比 line (#EDE7E0) 深一點點是刻意的 —— 它現在要承擔原本陰影
    在做的分隔工作，用一樣淺的話列表會糊成一片。
  */
  static const rowHead = Color(0xFFFAF8F5); // 列表表頭條。比 card 深、比 bg 淺。
  static const rowLine = Color(0xFFECE6DE); // 列表內的分隔線。
```

- [ ] **Step 4: 跑測試確認全綠**

```powershell
flutter test test/theme_contrast_test.dart
```

Expected: 全綠。原本 11 條 + 新的 2 條。

- [ ] **Step 5: 圓角整條下移**

`theme.dart` 的 `AppRadius`，五個值改成：

```dart
/// 圓角四階加一個藥丸。
///
/// 這一輪整條往下移一階：18px 的卡片圓角在密度提高之後會顯得鬆垮，
/// 而圓角本身不是這個方向要表達的東西。
///
/// **只改值，不改名，不改使用點。** 四階仍是四階，不會生出沒人用的常數。
abstract final class AppRadius {
  static const sm = 6.0;   // chip、分段控制的內層、小標籤
  static const md = 8.0;   // 按鈕、輸入框
  static const lg = 10.0;  // 卡片（cardTheme 自動跟著）
  static const xl = 14.0;  // 對話框、bottom sheet
  static const pill = 999.0;
}
```

- [ ] **Step 6: 按鈕最小高度 48 → 44**

`theme.dart` 裡有兩處 `minimumSize: const Size(0, 48)`，分別在 `filledButtonTheme` 與 `outlinedButtonTheme`。兩處都改成 `const Size(0, 44)`。

同時把 `filledButtonTheme` 上面那行註解從

```dart
    // 網頁版的 .btn 是 48px 高、--radius-md 圓角。
```

改成

```dart
    /*
      44px 而不是 48：44 是 iOS 的建議下限，也過得了 WCAG 2.5.8 的 24×24。
      48 在密度提高之後顯得笨重。

      網頁版還是 48 —— 這一輪只動手機版，兩邊會不一致直到網頁版跟上。
    */
```

- [ ] **Step 7: `figureStyle` 換成 `figure()`**

`theme.dart` 檔尾的 `figureStyle` 整段刪掉，換成：

```dart
/// 金額的字型。**畫面上每一個金額都要走這裡。**
///
/// 等寬數字讓一欄金額右對齊時位數對得齊 —— 比例字型的 1 比 6 窄，
/// 一整欄下來小數點會是歪的，而「對齊」是這一輪整個方向的核心。
///
/// 做成函式而不是常數，是因為原本那個 22px 的常數只有三個地方用得上，
/// 其餘尺寸的金額就全都沒有等寬數字了 —— 一個尺寸的常數等於一條沒人守得住的規則。
TextStyle figure({
  double size = 22,
  FontWeight weight = FontWeight.w700,
  Color color = AppColors.ink,
}) {
  return TextStyle(
    fontSize: size,
    fontWeight: weight,
    color: color,
    fontFeatures: const [FontFeature.tabularFigures()],
  );
}
```

- [ ] **Step 8: 換掉三個 `figureStyle` 使用點**

| 檔案 | 原本 | 改成 |
|---|---|---|
| `settlement_tab.dart:213` | `style: figureStyle,` | `style: figure(),` |
| `task_card.dart:111` | `style: figureStyle.copyWith(fontSize: 16),` | `style: figure(size: 16),` |
| `task_list_page.dart:371` | `style: figureStyle,` | `style: figure(),` |

改完 `figureStyle` 全專案應該搜不到：

```bash
cd flutter_app
grep -rn "figureStyle" lib/ test/    # 預期：無輸出
```

- [ ] **Step 9: analyze 與全套測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**（基線）；test **393 passed**。

analyze 如果多出 issue，多半是 `FontFeature` 的 import —— `theme.dart` 已經 import `package:flutter/material.dart`，`FontFeature` 來自 `dart:ui`，Material 有 re-export，應該不用另外加。真的缺就加 `import 'dart:ui' show FontFeature;`。

- [ ] **Step 10: 目視確認沒有爆版**

跑起來，**每一頁都翻一次**。這一步不是看好不好看，是看有沒有壞掉：

- 卡片圓角變小了，但沒有變成方角，也沒有內容被圓角切掉
- 按鈕矮了 4px，文字沒有被擠掉或換行
- 對話框與 bottom sheet 的圓角跟著變，沒有跟背後的東西對不齊

- [ ] **Step 11: Commit**

```bash
git add flutter_app/lib/ui/theme.dart flutter_app/test/theme_contrast_test.dart \
        flutter_app/lib/ui/settlement_tab.dart flutter_app/lib/ui/task_card.dart \
        flutter_app/lib/ui/task_list_page.dart
git commit -F - <<'MSG'
Make one number the whole app's corner radius

The card theme already routed through AppRadius.lg, so the entire app's
corners move on one line. They move down a step because 18px reads as
slack once the rest of the layout tightens.

figureStyle went the same way as the radius scale but never finished the
job: a single 22px constant meant three call sites had tabular figures
and every other amount in the app did not. It becomes figure(), because
a rule that only fits one size is a rule nobody can keep.

Buttons drop to 44px. That is the iOS floor and clears WCAG 2.5.8; the
web app stays at 48 until it catches up.
MSG
```

---

## Task 2: `ledger.dart`

**Files:**
- Create: `flutter_app/lib/ui/ledger.dart`
- Create: `flutter_app/test/ledger_test.dart`

**Interfaces:**
- Consumes：Task 1 的 `AppColors.rowHead`、`AppColors.rowLine`、`figure()`。
- Produces：`LedgerCard`、`LedgerStrip`、`LedgerRow`、`LedgerDivider`。Task 4 之後每個 Task 都用。

### 2.0 為什麼金額欄要固定寬度

用 `Expanded` 包標題、金額自然靠右的話，金額的**左緣**會跟著標題長度跑。右對齊看起來對了，但每一列的數字起點不同，位數還是對不齊 —— 那就只是「每列各自貼右邊」，不是一欄。

所以金額欄是 `SizedBox(width: LedgerRow.amountWidth)`，這也是這個檔案唯一測得到的東西。

- [ ] **Step 1: 寫會失敗的 widget test**

建立 `flutter_app/test/ledger_test.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:splitflow/ui/ledger.dart';
import 'package:splitflow/ui/theme.dart';

/// `ledger.dart` 測得到的只有兩件事：金額欄是不是真的固定寬度，
/// 以及金額是不是真的用等寬數字。
///
/// 版面好不好看測不到，也不該假裝測得到。但「一欄金額有沒有對齊」
/// 是有標準答案的，而那正是這一輪整個方向的核心 —— 所以它該有測試。
void main() {
  Widget wrap(Widget child) {
    return MaterialApp(
      theme: buildAppTheme(),
      home: Scaffold(body: SizedBox(width: 390, child: child)),
    );
  }

  testWidgets('標題長度不影響金額的左緣 —— 這就是「對齊成一欄」的意思', (tester) async {
    await tester.pumpWidget(
      wrap(
        const LedgerCard(
          children: [
            LedgerRow(title: '短', amount: '1,250'),
            LedgerRow(title: '很長很長很長很長很長很長的支出名稱', amount: '6,530'),
          ],
        ),
      ),
    );

    final short = tester.getTopLeft(find.text('1,250'));
    final long = tester.getTopLeft(find.text('6,530'));

    expect(short.dx, closeTo(long.dx, 0.01));
  });

  testWidgets('金額用等寬數字', (tester) async {
    await tester.pumpWidget(
      wrap(const LedgerCard(children: [LedgerRow(title: '晚餐', amount: '1,250')])),
    );

    final widget = tester.widget<Text>(find.text('1,250'));
    expect(
      widget.style?.fontFeatures,
      contains(const FontFeature.tabularFigures()),
    );
  });

  testWidgets('分隔線預設縮到內容起點，不是整條拉滿', (tester) async {
    await tester.pumpWidget(wrap(const LedgerDivider()));

    final box = tester.getRect(find.byType(LedgerDivider));
    final line = tester.getRect(
      find.descendant(
        of: find.byType(LedgerDivider),
        matching: find.byType(DecoratedBox),
      ),
    );

    expect(line.left - box.left, closeTo(AppSpace.x4, 0.01));
  });

  testWidgets('有圖示的列，分隔線縮到圖示右緣', (tester) async {
    await tester.pumpWidget(wrap(const LedgerDivider(indent: LedgerRow.iconIndent)));

    final box = tester.getRect(find.byType(LedgerDivider));
    final line = tester.getRect(
      find.descendant(
        of: find.byType(LedgerDivider),
        matching: find.byType(DecoratedBox),
      ),
    );

    expect(line.left - box.left, closeTo(44.0, 0.01));
  });
}
```

- [ ] **Step 2: 跑測試確認會失敗**

```powershell
flutter test test/ledger_test.dart
```

Expected: **編譯失敗** —— `Target of URI doesn't exist: 'package:splitflow/ui/ledger.dart'`。

- [ ] **Step 3: 實作 `ledger.dart`**

建立 `flutter_app/lib/ui/ledger.dart`：

```dart
/// 「一組內容一個容器」的四件套。
///
/// 網頁版靠 CSS class 就能共用這套長相（`.card` / `.card-strip` / `.row-line`），
/// Flutter 沒有這條路，所以它們得是真的 widget。
///
/// 這個檔案存在的理由是一句話：**卡片從「每一則內容一張」變成「一組內容一個」**。
/// 三張任務卡並排變成一張卡三列，中間一條線。密度就是這樣來的，
/// 而分隔線取代的正是原本陰影在做的事。
library;

import 'package:flutter/material.dart';

import 'theme.dart';

/// 卡片容器。
///
/// `clipBehavior` 是必要的：表頭條與分隔線都是滿寬的方塊，不裁切的話
/// 它們會從圓角的缺口露出方角來。
class LedgerCard extends StatelessWidget {
  final List<Widget> children;

  const LedgerCard({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: children,
      ),
    );
  }
}

/// 卡頂的表頭條。左邊講這一組是什麼，右邊講它的小計。
///
/// 用底色而不是粗體字來分層：粗體字跟列裡的標題只差一個字重，
/// 掃視的時候分不出哪一行是標題。
class LedgerStrip extends StatelessWidget {
  final String title;
  final String? trailing;

  const LedgerStrip({super.key, required this.title, this.trailing});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.rowHead,
        border: Border(bottom: BorderSide(color: AppColors.rowLine)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.x4,
          vertical: 10,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
            if (trailing != null)
              Text(
                trailing!,
                style: figure(
                  size: 13,
                  weight: FontWeight.w400,
                  color: AppColors.muted,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 卡片裡的一列。
///
/// [amount] 走固定寬度而不是讓它自然靠右：用 Expanded 包標題的話，金額的
/// **左緣**會跟著標題長度跑，右對齊就只是每列各自貼右邊，位數還是對不齊。
class LedgerRow extends StatelessWidget {
  /// 金額欄的固定寬度。夠放到七位數（`999,999`）。
  static const amountWidth = 76.0;

  /// 有圖示時，分隔線該縮到的位置 —— 圖示的右緣。
  static const iconIndent = 44.0;

  final IconData? icon;
  final String title;
  final String? subtitle;
  final String? amount;
  final Color? amountColor;
  final Widget? trailing;
  final VoidCallback? onTap;

  const LedgerRow({
    super.key,
    this.icon,
    required this.title,
    this.subtitle,
    this.amount,
    this.amountColor,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.x4,
        vertical: AppSpace.x3,
      ),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 18, color: AppColors.primaryDark),
            const SizedBox(width: AppSpace.x3),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontSize: 14, color: AppColors.ink),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: AppSpace.text),
                  Text(
                    subtitle!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (amount != null)
            SizedBox(
              width: amountWidth,
              child: Text(
                amount!,
                textAlign: TextAlign.right,
                style: figure(
                  size: 15,
                  weight: FontWeight.w600,
                  color: amountColor ?? AppColors.ink,
                ),
              ),
            ),
          if (trailing != null) ...[
            const SizedBox(width: AppSpace.x2),
            trailing!,
          ],
        ],
      ),
    );

    if (onTap == null) return row;
    return InkWell(onTap: onTap, child: row);
  }
}

/// 列與列之間的線。
///
/// [indent] 預設縮到內容起點；有圖示的列傳 [LedgerRow.iconIndent]。
/// 整條拉滿會讓列表看起來像表格而不是清單。
class LedgerDivider extends StatelessWidget {
  final double indent;

  const LedgerDivider({super.key, this.indent = AppSpace.x4});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: indent),
      child: const DecoratedBox(
        decoration: BoxDecoration(color: AppColors.rowLine),
        child: SizedBox(height: 1, width: double.infinity),
      ),
    );
  }
}
```

- [ ] **Step 4: 跑測試確認四條都過**

```powershell
flutter test test/ledger_test.dart
```

Expected: **4 passed**。

第一條如果紅了，看訊息裡兩個 `dx` 差多少 —— 差的數字通常就是兩個標題的長度差，那代表金額欄沒有真的固定寬度。

- [ ] **Step 5: 確認第一條測試抓得到它要抓的東西**

驗收裡最容易造假的一項。把 `LedgerRow` 裡的

```dart
            SizedBox(
              width: amountWidth,
```

暫時改成

```dart
            SizedBox(
```

（拿掉固定寬度）然後：

```powershell
flutter test test/ledger_test.dart
```

Expected: **第一條紅**（兩個 dx 差很多），其餘三條綠。

如果第一條還是綠的，測試沒測到該測的東西，回 Step 1 修測試。

**改回來，再跑一次確認四條全綠。**

- [ ] **Step 6: analyze 與全套測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**；test **397 passed**。

- [ ] **Step 7: Commit**

```bash
git add flutter_app/lib/ui/ledger.dart flutter_app/test/ledger_test.dart
git commit -F - <<'MSG'
Give the app one place to decide what a list looks like

The web version keeps this vocabulary in three CSS classes. Flutter has
no equivalent, so card, header strip, row and divider have to be real
widgets or every screen invents its own again.

The amount column is a fixed width, not an Expanded sibling. Letting it
size itself puts every row's number at a different starting x, so the
column reads as right-aligned while the digits still do not line up --
which is the one thing this whole direction is about. That is also the
only part of the file a test can see, so it is the part with a test.
MSG
```

---

## Task 3: 分類圖示 `String` → `IconData`

**Files:**
- Modify: `flutter_app/lib/domain/models.dart:12-27`
- Modify: `flutter_app/lib/ui/category_chart.dart:75`
- Modify: `flutter_app/lib/ui/expense_detail_page.dart:72`
- Modify: `flutter_app/lib/ui/expense_form_page.dart:512`
- Modify: `flutter_app/lib/ui/report_page.dart:261-262, 418-421`

**Interfaces:**
- Produces：`CategoryMeta.icon` 的型別變成 `IconData`。Task 5–9 畫列的時候直接餵給 `LedgerRow(icon: ...)`。

### 3.0 這一步為什麼要獨立

它是整個計畫裡**唯一動到 `lib/ui/` 以外**的一步，而且是型別變更 —— 編譯器會把所有使用點找出來給你。跟版面改動混在一起 commit 的話，將來要回退這個決定會很難拆。

`models.dart` 是純值物件、刻意不依賴 Flutter。加 `IconData` 會讓它 import `material.dart`。這是接受的：`CategoryMeta` 本來就叫「顯示資料」，它已經在存 label 了。

- [ ] **Step 1: 改型別與六個值**

`models.dart`，`enum ExpenseCategory` 上方加 import（檔案現在只有 `library;`，沒有 import）：

```dart
import 'package:flutter/material.dart';
```

然後 `CategoryMeta` 與清單改成：

```dart
/// 分類的顯示資料。順序就是選單的順序，也是金額相同時的次要排序依據。
///
/// icon 是 IconData 而不是 emoji 字串：emoji 在不同 Android 版本與廠商 ROM
/// 上長得不一樣，控制不了，而且上不了色 —— 跟「圖示用 primaryDark」這條
/// 規則直接衝突。Material Icons 已經在 bundle 裡，不增加 APK 大小。
///
/// 網頁版還是 emoji。圖示不像顏色那樣是身分，兩邊不一致可以接受。
class CategoryMeta {
  final ExpenseCategory value;
  final String label;
  final IconData icon;
  const CategoryMeta(this.value, this.label, this.icon);
}

const List<CategoryMeta> expenseCategories = [
  CategoryMeta(ExpenseCategory.food, '餐飲', Icons.restaurant_outlined),
  CategoryMeta(ExpenseCategory.transport, '交通', Icons.directions_car_outlined),
  CategoryMeta(ExpenseCategory.stay, '住宿', Icons.bed_outlined),
  CategoryMeta(ExpenseCategory.ticket, '門票', Icons.confirmation_number_outlined),
  CategoryMeta(ExpenseCategory.shopping, '購物', Icons.shopping_bag_outlined),
  CategoryMeta(ExpenseCategory.other, '其他', Icons.inventory_2_outlined),
];
```

- [ ] **Step 2: 跑 analyze，讓編譯器列出所有使用點**

```powershell
flutter analyze
```

Expected: **5 個錯誤**，分別在 `category_chart.dart:75`、`expense_detail_page.dart:72`、`expense_form_page.dart:512`、`report_page.dart:261`、`report_page.dart:418`。

如果數量不是 5，先搞清楚多出來的是什麼，不要直接改。

- [ ] **Step 3: `category_chart.dart:75`**

原本：

```dart
              child: Text('${meta.icon} ${meta.label}', style: text.bodyMedium),
```

改成：

```dart
              child: Row(
                children: [
                  Icon(meta.icon, size: 16, color: AppColors.primaryDark),
                  const SizedBox(width: AppSpace.x2),
                  Text(meta.label, style: text.bodyMedium),
                ],
              ),
```

`category_chart.dart` 如果還沒 import `theme.dart`，加上 `import 'theme.dart';`。

- [ ] **Step 4: `expense_detail_page.dart:72`**

原本：

```dart
                Text(meta.icon, style: const TextStyle(fontSize: 30)),
```

改成：

```dart
                Icon(meta.icon, size: 30, color: AppColors.primaryDark),
```

- [ ] **Step 5: `expense_form_page.dart:512`**

原本：

```dart
                                label: Text('${meta.icon} ${meta.label}'),
```

改成：

```dart
                                avatar: Icon(meta.icon, size: 16),
                                label: Text(meta.label),
```

`ChoiceChip` 的 `avatar` 會自動跟著選中狀態變色，所以這裡不指定顏色。

- [ ] **Step 6: `report_page.dart:261-262`**

原本：

```dart
                  label: '${categoryMeta(item.category).icon} '
                      '${categoryMeta(item.category).label}',
```

這是傳給某個子 widget 的 `label` 字串參數。**先看那個 widget 的簽章**，把它的 `String label` 改成兩個參數：

```dart
                  icon: categoryMeta(item.category).icon,
                  label: categoryMeta(item.category).label,
```

然後在那個子 widget 裡，把原本印 `label` 的 `Text` 換成 `Row(children: [Icon(icon, size: 16, color: AppColors.primaryDark), SizedBox(width: AppSpace.x2), Text(label)])`。

- [ ] **Step 7: `report_page.dart:418-421`**

原本：

```dart
                      '${categoryMeta(entry.category).icon} '
                      ...
                      '${entry.place ?? categoryMeta(entry.category).label}',
```

這是時間軸的一列：「圖示 · 地點（沒有地點就寫分類）」。拆成：

```dart
                    Icon(
                      categoryMeta(entry.category).icon,
                      size: 16,
                      color: AppColors.primaryDark,
                    ),
                    const SizedBox(width: AppSpace.x2),
                    Text(entry.place ?? categoryMeta(entry.category).label),
```

外層如果原本是單一個 `Text`，要包成 `Row`。

- [ ] **Step 8: 確認沒有殘留**

```bash
cd flutter_app
grep -rn "meta.icon}" lib/           # 預期：無輸出（字串內插沒了）
grep -rn "🍽\|🚗\|🏨\|🎟\|🛍\|📦" lib/  # 預期：無輸出
```

- [ ] **Step 9: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**（回到基線）；test **397 passed**。

測試不該有任何一條紅 —— `grep` 已經確認過 `test/` 裡沒有任何地方用到 `meta.icon`。

- [ ] **Step 10: 目視確認六個分類都有圖示**

進「新增支出」，六個分類 chip 都要有圖示且看得出是什麼。特別看「門票」與「其他」—— 這兩個的 Material 圖示最不直觀。

- [ ] **Step 11: Commit**

```bash
git add flutter_app/lib/domain/models.dart flutter_app/lib/ui/category_chart.dart \
        flutter_app/lib/ui/expense_detail_page.dart flutter_app/lib/ui/expense_form_page.dart \
        flutter_app/lib/ui/report_page.dart
git commit -F - <<'MSG'
Stop letting the phone's vendor decide what a category looks like

Category icons were emoji in a string, which means the glyph changes
between Android versions and OEM skins, and it cannot take a colour --
so it could never follow the rule that says icons are drawn in
primaryDark. Material icons ship in the bundle already.

This is the one change in this round that reaches past lib/ui/, so it
is its own commit: the type change makes the compiler list every call
site, and keeping it separate means the decision can be backed out
without unpicking any layout work.

The web app keeps its emoji. An icon is not an identity colour; the two
platforms can differ here without anyone feeling it.
MSG
```

---

## Task 4: 任務頁 —— 結算上頂、頁籤收二

**Files:**
- Create: `flutter_app/lib/ui/settlement_page.dart`
- Modify: `flutter_app/lib/ui/task_page.dart:180-240`

**Interfaces:**
- Consumes：Task 2 的 `LedgerCard`、`LedgerRow`、`LedgerDivider`。
- Produces：`SettlementPage`（`settlement_page.dart`），Task 5 之後不需要知道它。

### 4.0 這是整個計畫唯一動到資訊架構的一步

其餘每一個 Task 都是換外觀。這一個是把「我還要付誰多少」從第三個頁籤搬到第一眼看得到的地方。

**`settlement_tab.dart` 的內部一行都不改。** 它從 `TabBarView` 的一個 child 變成 `SettlementPage` 的 body，僅此而已。它已經吃 `task` 與 `archived` 兩個參數，兩個都拿得到。

**風險：** `SettlementTab` 現在活在 `TabBarView` 裡，會跟著 tab 一起建。搬進 `Navigator.push` 之後它是新的一棵樹，Riverpod 的 provider 會重新訂閱。這不是錯，但要走查確認資料真的有進來、而且沒有閃一下空白。

- [ ] **Step 1: 先確認行尾**

```bash
cd flutter_app
file lib/ui/task_page.dart      # 預期看到 CRLF
```

用腳本改這個檔案前先讀這一行的結果。直接用編輯工具就不用管。

- [ ] **Step 2: 建立 `settlement_page.dart`**

```dart
/// 完整結算與付款紀錄。原本是任務頁的第三個頁籤。
///
/// 搬出來的理由不是這一頁不重要，正好相反：「我還要付誰多少」是這個 app
/// 存在的理由，所以它的**答案**該在任務頁第一眼看得到（那是頂部的摘要卡），
/// 而完整的面板 —— 五個人互相欠、付款記錄、確認流程 —— 是答案的後續，
/// 不是每次進任務頁都要看的東西。
///
/// 這一頁只是外殼。`SettlementTab` 的內部完全沒有改。
library;

import 'package:flutter/material.dart';

import '../domain/models.dart';
import 'settlement_tab.dart';

class SettlementPage extends StatelessWidget {
  final Task task;
  final bool archived;

  const SettlementPage({super.key, required this.task, required this.archived});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('結算與付款紀錄')),
      body: SettlementTab(task: task, archived: archived),
    );
  }
}
```

- [ ] **Step 3: 頁籤從三個收成兩個**

`task_page.dart`，`TabBar` 那一段：

```dart
          bottom: const TabBar(
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.muted,
            indicatorColor: AppColors.primary,
            tabs: [
              Tab(text: '支出'),
              Tab(text: '成員'),
              Tab(text: '結算'),
            ],
          ),
```

改成：

```dart
          /*
            兩個頁籤，不是三個。結算搬到上面的摘要卡與它的次頁 ——
            這個 app 存在的理由不該在第三個頁籤裡。

            labelColor 用 primaryDark 而不是 primary：選中的頁籤是**文字**，
            而 primary 對頁面底色只有 3.6:1。
          */
          bottom: const TabBar(
            labelColor: AppColors.primaryDark,
            unselectedLabelColor: AppColors.muted,
            indicatorColor: AppColors.primaryDark,
            tabs: [
              Tab(text: '支出'),
              Tab(text: '成員'),
            ],
          ),
```

同時 `TabBarView` 的 children 從三個刪成兩個 —— 刪掉 `SettlementTab(task: task, archived: archived),` 那一行。

**`DefaultTabController` 的 `length` 也要從 3 改成 2。** 忘了改的話是執行期錯誤，不是編譯錯誤。搜 `length:` 找它。

- [ ] **Step 4: 在頁籤上面加結算摘要卡**

`task_page.dart` 的 `body: Column(children: [...])` 裡，在 `if (archived)` 那個封存橫幅**之後**、`Expanded(child: TabBarView(...))` **之前**，插入摘要卡。

摘要卡要的資料跟 `SettlementTab` 是同一批，從同一個 provider 來。**先讀 `settlement_tab.dart` 的前 60 行**，看它 watch 哪個 provider、算出來的型別是什麼，然後在這裡 watch 同一個。

摘要卡本身：

```dart
Padding(
  padding: const EdgeInsets.fromLTRB(AppSpace.x4, AppSpace.x3, AppSpace.x4, 0),
  child: LedgerCard(
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.x4, AppSpace.x4, AppSpace.x4, AppSpace.x3,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('我的分攤', style: text.bodySmall),
            const SizedBox(height: AppSpace.text),
            // 這是頁面上唯一的主數字，所以幣別跟金額連寫。
            Text(
              '${task.defaultCurrency} $myShareFormatted',
              style: figure(size: 32, color: AppColors.primaryDark),
            ),
            const SizedBox(height: AppSpace.text),
            Text('這趟總額 $totalFormatted · $expenseCount 筆', style: text.bodySmall),
          ],
        ),
      ),
      const LedgerDivider(indent: 0),
      // 每一筆轉帳一列。方向不能只靠顏色 —— 文案本身就是「你付給 X」
      // 與「X 付給你」，色覺障礙的人讀文字就分得出來。
      for (final line in myLines) ...[
        LedgerRow(
          icon: line.outgoing ? Icons.arrow_forward : Icons.arrow_back,
          title: line.outgoing ? '你付給 ${nameOf(line.to)}' : '${nameOf(line.from)} 付給你',
          amount: formatAmount(line.amount),
          amountColor: line.outgoing ? AppColors.ink : AppColors.success,
        ),
        const LedgerDivider(indent: LedgerRow.iconIndent),
      ],
      LedgerRow(
        title: '完整結算與付款紀錄',
        trailing: const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
        onTap: () => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => SettlementPage(task: task, archived: archived),
          ),
        ),
      ),
    ],
  ),
),
```

`myShareFormatted`、`totalFormatted`、`expenseCount`、`myLines`、`nameOf`、`formatAmount` 要照 `settlement_tab.dart` 現有的算法接 —— **不要自己算**，那是規格明令不動的部分。

已結清時 `myLines` 是空的：那就只剩「完整結算」那一列，摘要卡不會空掉。

- [ ] **Step 5: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**；test **397 passed**。

- [ ] **Step 6: 目視走一遍（要有裝置或模擬器）**

這一步是這個 Task 的重點，不能跳：

- 進任務頁，**不捲動**就看得到「我的分攤」跟至少一列轉帳
- 點「完整結算與付款紀錄」→ 進得去、資料是對的、**沒有閃一下空白**
- 次頁按返回 → 回到任務頁，頁籤還在原來那個
- 頁籤只有兩個，切換正常
- 找一個已經結清的任務：摘要卡只有「完整結算」那一列，不是空白

- [ ] **Step 7: Commit**

```bash
git add flutter_app/lib/ui/settlement_page.dart flutter_app/lib/ui/task_page.dart
git commit -F - <<'MSG'
Move the answer out of the third tab

"How much do I owe whom" is the reason this app exists, and it was
behind a tab nobody lands on. The summary comes to the top of the task
page; the full panel -- five people owing each other, payment history,
the confirm flow -- becomes a page you go to, because that is follow-up
rather than something to read on every visit.

SettlementTab itself is untouched. It stops being a TabBarView child and
becomes a Scaffold body, which does mean its providers resubscribe on a
fresh tree, so the walkthrough checks that the data arrives without a
blank frame first.

The web app made this same move two rounds ago.
MSG
```

---

## Task 5: 任務列表與任務卡

**Files:**
- Modify: `flutter_app/lib/ui/task_card.dart`
- Modify: `flutter_app/lib/ui/task_list_page.dart`

**Interfaces:**
- Consumes：`LedgerCard`、`LedgerRow`、`LedgerDivider`、`figure()`。

- [ ] **Step 1: `task_card.dart` 從卡片變成列**

現在 `TaskCard` 自己是一張 `Card`，有 `box-shadow: var(--shadow-raise)` 的等價物（`task_card.dart:108` 附近的 elevation 或 BoxShadow）。

改成回傳一個 `LedgerRow`：

```dart
    return LedgerRow(
      title: task.name,
      subtitle: '$dateRange · $roleLabel · ${task.memberCount} 人 · ${task.expenseCount} 筆',
      amount: myCost == null ? null : formatAmount(myCost!),
      trailing: const Icon(Icons.chevron_right, size: 18, color: AppColors.lineStrong),
      onTap: onOpen,
    );
```

`dateRange` 照現有算法（`task.startDate` 與 `task.endDate`，未設定時的處理不要改）。

**封存的任務**：外面包 `Opacity(opacity: 0.75, child: ...)`，並把 `trailing` 換成「已封存」小標籤。封存卡不給刪除鈕的規則不變。

**原本的封存／解除封存／刪除按鈕**改成 `trailing` 位置的 `PopupMenuButton` —— 一列裡放不下兩顆按鈕，而且列現在可以整列點進去，按鈕疊在上面會搶點擊。

- [ ] **Step 2: `task_list_page.dart` 的任務列表合併成一張卡**

原本是 `for (final task in parts.active) ... TaskCard(...)` 各自一張卡。改成：

```dart
                if (parts.active.isNotEmpty) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpace.x4, AppSpace.x2, AppSpace.x4, AppSpace.x2,
                    ),
                    child: Text('進行中 ${parts.active.length}', style: text.bodySmall),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpace.x4),
                    child: LedgerCard(
                      children: [
                        for (var i = 0; i < parts.active.length; i++) ...[
                          if (i > 0) const LedgerDivider(),
                          TaskCard(task: parts.active[i], ...),
                        ],
                      ],
                    ),
                  ),
                ],
```

已封存那一組同樣處理，標題是「已封存 N」。

- [ ] **Step 3: hero 加一列三格的每趟小計**

`task_list_page.dart` 的「我的總花費」那張卡，在佔比條下面加一列：

```dart
              // 佔比條講的是比例，這一列講的是絕對數字。條子上不能放文字，
              // 所以每一趟到底多少錢本來是看不到的。
              Container(
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: AppColors.rowLine)),
                ),
                child: Row(
                  children: [
                    for (var i = 0; i < blocks.take(3).length; i++) ...[
                      if (i > 0)
                        const SizedBox(
                          height: 44,
                          child: VerticalDivider(width: 1, color: AppColors.rowLine),
                        ),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpace.x3, vertical: 10,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(blocks[i].name, style: text.bodySmall),
                              Text(
                                formatAmount(blocks[i].amount),
                                style: figure(size: 14, weight: FontWeight.w600),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
```

只取前三趟：四格以上在 390px 寬度會擠到看不清楚。

- [ ] **Step 4: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**；test **397 passed**。

- [ ] **Step 5: 目視走一遍**

- 任務列表是一張卡多列，不是一張張分開的卡
- **每一列的「我的花費」左緣在同一條垂直線上** —— 這是 Task 2 的固定欄寬在真實資料上的驗收
- 整列可以點進任務頁；右邊的選單按得開，而且**點選單不會連帶導航**
- 封存的那一組在下面，淡一階，有「已封存」標籤
- hero 的三格小計，數字跟佔比條的比例對得起來

- [ ] **Step 6: Commit**

```bash
git add flutter_app/lib/ui/task_card.dart flutter_app/lib/ui/task_list_page.dart
git commit -F - <<'MSG'
Stop giving every trip its own floating card

Three trips meant three raised cards, which is three claims that this
one matters more than the page around it -- made three times, so none of
them land. They become rows in one card, and the shadow's job goes to a
divider.

The per-trip amounts now line up in a column, which is the first time
the fixed amount width from ledger.dart meets real data. The row is also
tappable end to end now, so the archive and delete buttons move into a
menu; two buttons sitting on top of a tappable row is a fight over the
same pixels.

The share bar could only ever show proportions. The three figures under
it say what those proportions are actually worth.
MSG
```

---

## Task 6: 支出表單

**Files:**
- Modify: `flutter_app/lib/ui/expense_form_page.dart`

**Interfaces:**
- Consumes：`LedgerCard`、`LedgerRow`、`LedgerDivider`、`figure()`。

### 6.0 這個檔案剛改過

上一輪（`2026-09-03-flutter-visual-alignment` 的 Task 3、4）才把它整成三張卡加固定送出列。這一輪保留那個結構，改的是**卡片內部**：

- 私有 `_Card` widget 刪掉，改用 `LedgerCard`
- 金額從卡 1 的一個欄位變成**卡 1 的全部**，40px 大字
- 其餘欄位從上下堆疊的 label + input 改成左標籤右值的 key-value 列
- 分類從一排 chip 改成 4 欄格子
- 底部固定列左邊加換算後合計

- [ ] **Step 1: 刪掉 `_Card`，換成 `LedgerCard`**

搜 `_Card(` —— 上一輪的驗收說是 4 個（宣告 1 + 使用 3）。刪掉宣告，三個使用點換成 `LedgerCard(children: [...])`。

注意 `_Card` 原本可能吃 `child:` 單數，`LedgerCard` 吃 `children:` 複數。

- [ ] **Step 2: 金額獨立成第一張卡**

卡 1 從「分類 + 名稱 + 金額 + 幣別 + 匯率」縮成只有金額那一組：

```dart
        LedgerCard(
          children: [
            Padding(
              padding: const EdgeInsets.all(AppSpace.x4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text('金額', style: text.bodySmall)),
                      // 幣別是右上角的小按鈕，不是跟金額並排的第二個輸入框：
                      // 並排會讓兩個欄位看起來一樣重要，但九成的支出不換幣別。
                      OutlinedButton(
                        onPressed: _pickCurrency,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 32),
                          padding: const EdgeInsets.symmetric(horizontal: AppSpace.x3),
                        ),
                        child: Text(currency),
                      ),
                    ],
                  ),
                  TextField(
                    controller: amountController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: figure(size: 40),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      hintText: '0',
                      isDense: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                ],
              ),
            ),
            // 跨幣別才出現。匯率與換算結果是同一件事的兩半，壓成一條。
            if (currency != baseCurrency) ...[
              const LedgerDivider(indent: 0),
              // ...匯率輸入 + 「≈ TWD 1,138」，沿用現有的匯率欄位與 rateError 邏輯
            ],
          ],
        ),
```

**匯率的驗證邏輯（`rateError`、`rateFormatError`）一行都不要改**，只換版面。

- [ ] **Step 3: 分類改 4 欄格子**

原本是一排 `ChoiceChip`。改成：

```dart
              GridView.count(
                crossAxisCount: 4,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: AppSpace.x2,
                crossAxisSpacing: AppSpace.x2,
                childAspectRatio: 1.15,
                children: [
                  for (final meta in expenseCategories)
                    InkWell(
                      onTap: () => setState(() => category = meta.value),
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: category == meta.value ? AppColors.primaryDark : null,
                          border: category == meta.value
                              ? null
                              : Border.all(color: AppColors.lineStrong),
                          borderRadius: BorderRadius.circular(AppRadius.md),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              meta.icon,
                              size: 18,
                              color: category == meta.value ? Colors.white : AppColors.primaryDark,
                            ),
                            const SizedBox(height: AppSpace.x1),
                            Text(
                              meta.label,
                              style: TextStyle(
                                fontSize: 11,
                                color: category == meta.value ? Colors.white : AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
```

六個分類配 4 欄 = 兩列，第二列兩格。格子高度（`childAspectRatio: 1.15` 在 390px 寬下約 78px）過得了 44px 的下限。

- [ ] **Step 4: 底部固定列加合計**

上一輪做的 `bottomNavigationBar` 保留，左邊加一塊：

```dart
        Row(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('合計', style: text.bodySmall),
                Text(
                  convertedLabel,   // 跨幣別時是換算後的，否則就是金額本身
                  style: figure(size: 16),
                ),
              ],
            ),
            const SizedBox(width: AppSpace.x3),
            Expanded(child: /* 現有的送出鈕，不動 */),
          ],
        ),
```

- [ ] **Step 5: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**；test **397 passed**。

- [ ] **Step 6: 目視走一遍**

- `_Card` 搜不到：`grep -rn "_Card" lib/ui/expense_form_page.dart` 無輸出
- 只填名稱與金額，**不捲動**就按得到送出（上一輪的成果不能被弄壞）
- 點金額欄位叫出鍵盤 → **固定送出列被推到鍵盤正上方**；收起來回到底部
- 選外幣 → 匯率那一條出現在卡 1 裡，換算結果在同一條上
- 底部合計跟換算結果是同一個數字
- 六個分類格子都按得到，選中的那個看得出來

- [ ] **Step 7: Commit**

```bash
git add flutter_app/lib/ui/expense_form_page.dart
git commit -F - <<'MSG'
Let the amount be the thing the form is about

Eleven fields got equal weight, including the one the whole screen
exists to capture. The amount takes the first card on its own at 40px,
and the currency becomes a small button beside the label rather than a
second input of equal size -- nine times out of ten it is not being
changed.

The private _Card from last round folds into LedgerCard. It was only
ever a local copy of something every screen needed.

Categories move to a four-wide grid of icons. A single row of chips ran
off the edge at six categories, so the last two were behind a scroll
nobody knew was there.

The bottom bar now carries the converted total next to the submit
button, which is the number people actually check before committing.
MSG
```

---

## Task 7: 旅費報告頁

**Files:**
- Modify: `flutter_app/lib/ui/report_page.dart`

**Interfaces:**
- Consumes：`LedgerCard`、`LedgerStrip`、`LedgerRow`、`LedgerDivider`、`figure()`。

- [ ] **Step 1: 每人平均改大字**

主數字改成：

```dart
            Text('每人平均', style: text.bodySmall),
            Text(
              '${report.currency} ${formatAmount(report.perPerson, report.currency)}',
              style: figure(size: 38, color: AppColors.primaryDark),
            ),
```

用 `primaryDark` 而不是 `ink`：這是整份報告唯一的主張，值得是有顏色的。`primaryDark` 對白底 4.6:1 過得了 AA。

- [ ] **Step 2: 總花費／筆數／地點收成三格**

主數字下面：

```dart
            DecoratedBox(
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.rowLine),
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Row(
                children: [
                  for (var i = 0; i < 3; i++) ...[
                    if (i > 0)
                      const SizedBox(
                        height: 44,
                        child: VerticalDivider(width: 1, color: AppColors.rowLine),
                      ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpace.x3, vertical: 9,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              ['總花費', '筆數', '地點'][i],
                              style: text.bodySmall,
                            ),
                            Text(
                              [
                                formatAmount(report.total, report.currency),
                                '${report.expenseCount}',
                                '${report.places.length}',
                              ][i],
                              style: figure(size: 14, weight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
```

- [ ] **Step 3: 「花在哪」改五欄對齊**

每一列從「圖示 名稱 ... 百分比 金額」加上長條，五個東西固定各自的欄位：

```dart
                  Row(
                    children: [
                      Icon(meta.icon, size: 16, color: AppColors.primaryDark),
                      const SizedBox(width: AppSpace.x3),
                      SizedBox(width: 42, child: Text(meta.label, style: text.bodyMedium)),
                      const SizedBox(width: AppSpace.x3),
                      // 長條吃掉剩下的寬度，所以每一列的長條起點與終點都一樣 ——
                      // 比例才比得出來。
                      Expanded(child: ReportBarEquivalent(value: item.share / 100)),
                      const SizedBox(width: AppSpace.x3),
                      SizedBox(
                        width: 32,
                        child: Text(
                          '${item.share.round()}%',
                          textAlign: TextAlign.right,
                          style: text.bodySmall,
                        ),
                      ),
                      const SizedBox(width: AppSpace.x2),
                      SizedBox(
                        width: 56,
                        child: Text(
                          formatAmount(item.total, report.currency),
                          textAlign: TextAlign.right,
                          style: figure(size: 14, weight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
```

`ReportBarEquivalent` 是現有的長條 widget —— **看 `report_page.dart` 裡現在怎麼畫長條，沿用它**，不要新寫一個。

- [ ] **Step 4: 各區塊改成有 `LedgerStrip` 的 `LedgerCard`**

「花在哪」「去過的地方」「每天怎麼過的」三區，各自包成：

```dart
          LedgerCard(
            children: [
              LedgerStrip(title: '花在哪', trailing: formatAmount(report.total, report.currency)),
              // ...列
            ],
          ),
```

時間軸的每一天用 `LedgerStrip(title: 'Day N · M 月 D 日', trailing: 當日小計)`。

- [ ] **Step 5: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**；test **397 passed**。

- [ ] **Step 6: 目視走一遍**

需要一份真的報告 —— 先封存一個有支出的任務並產生報告（Task 4 之後入口在標題列的「報告」）。

- 每人平均是橘色大字，讀得清楚
- 「花在哪」四個分類的**長條起點在同一條線上、百分比與金額各自對齊**
- 三格統計的分隔線沒有超出圓角
- 地圖還在、載得出來
- 時間軸每一天的表頭條看得出是表頭，不是另一列資料

- [ ] **Step 7: Commit**

```bash
git add flutter_app/lib/ui/report_page.dart
git commit -F - <<'MSG'
Make the categories comparable instead of merely listed

Each category row sized itself, so the bars started at different x
positions and comparing two of them meant comparing two lengths that did
not share an origin. Five fixed columns -- icon, name, bar, percent,
amount -- and the bars finally line up, which is the only reason to draw
them.

The per-person figure goes large and takes primaryDark. It is the one
claim this report makes, so it can afford to be the one coloured thing
on the page; 4.6:1 on white clears AA.

Section headers become strips rather than bold text. Bold was one weight
away from the rows underneath it, which is not enough to tell a heading
from data when scanning.
MSG
```

---

## Task 8: 其餘畫面

**Files:**
- Modify: `flutter_app/lib/ui/expense_row.dart`
- Modify: `flutter_app/lib/ui/expense_detail_page.dart`
- Modify: `flutter_app/lib/ui/profile_page.dart`
- Modify: `flutter_app/lib/ui/report_card.dart`
- Modify: `flutter_app/lib/ui/explore_page.dart`
- Modify: `flutter_app/lib/ui/favorites_page.dart`
- Modify: `flutter_app/lib/ui/create_task_page.dart`
- Modify: `flutter_app/lib/ui/join_task_page.dart`

- [ ] **Step 1: `expense_row.dart` → `LedgerRow`**

```dart
    return LedgerRow(
      icon: categoryMeta(expense.category).icon,
      title: expense.title,
      subtitle: '$payerName先付 · $splitLabel',
      amount: formatAmount(expense.amount, expense.currency),
      onTap: onOpen,
    );
```

`payerName` 與 `splitLabel` 照現有算法。**能不能管理這筆支出（`canManage`）的邏輯不要動**，只是它現在決定的是選單出不出現，不是按鈕。

- [ ] **Step 2: `expense_form_page.dart` 的日期分組改用 `LedgerCard` + `LedgerStrip`**

一天一張 `LedgerCard`，`LedgerStrip(title: '3 月 3 日 · 週二', trailing: 當日小計)`，底下每筆支出一個 `expense_row` 加 `LedgerDivider(indent: LedgerRow.iconIndent)`。

（這一段在 `task_page.dart` 的 `_ExpensesTab` 裡，不在 `expense_form_page.dart`。以實際檔案為準 —— 搜 `ExpenseDayGroup` 的 Dart 等價物。）

- [ ] **Step 3: `expense_detail_page.dart` 金額上頂**

金額變成頁面頂部的大字（`figure(size: 34)`），其餘欄位（分類、日期、地點、付款人、分攤、備註、收據）改成 `LedgerCard` 裡的 key-value 列：左標籤 `bodySmall`、右值 `bodyMedium`，用 `LedgerRow(title: 標籤, trailing: Text(值))`。

- [ ] **Step 4: `profile_page.dart` 每組改 `LedgerCard`**

上一輪已經分過組（`5857a86`）。這一輪每組從一堆 `ListTile` 改成 `LedgerCard` + `LedgerStrip(title: 組名)` + `LedgerRow` 多列，設定項目的現值顯示在右邊。

- [ ] **Step 5: `report_card.dart` → `LedgerRow`**

```dart
    return LedgerRow(
      title: report.taskName,
      subtitle: '${report.days} 天 · ${report.memberCount} 人',
      amount: formatAmount(report.perPerson, report.currency),
      onTap: onOpen,
    );
```

- [ ] **Step 6: `explore_page.dart` 與 `favorites_page.dart` 包成一張卡**

原本各自一張卡的 `ReportCard` 列表，包成一個 `LedgerCard`，中間 `LedgerDivider()`。空狀態與載入狀態不動。

- [ ] **Step 7: `create_task_page.dart` 與 `join_task_page.dart` 表單改 key-value 列**

跟支出表單同一套：`LedgerCard` 裡一列一個欄位，左標籤右輸入。**驗證邏輯與送出流程不動。**

- [ ] **Step 8: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**；test **397 passed**。

- [ ] **Step 9: 目視走一遍這八個畫面**

每一個都要開起來看過。重點：金額對齊、按鈕還好按、沒有被圓角切掉的內容。

- [ ] **Step 10: Commit**

```bash
git add flutter_app/lib/ui/expense_row.dart flutter_app/lib/ui/expense_detail_page.dart \
        flutter_app/lib/ui/profile_page.dart flutter_app/lib/ui/report_card.dart \
        flutter_app/lib/ui/explore_page.dart flutter_app/lib/ui/favorites_page.dart \
        flutter_app/lib/ui/create_task_page.dart flutter_app/lib/ui/join_task_page.dart \
        flutter_app/lib/ui/task_page.dart
git commit -F - <<'MSG'
Say the same thing on the eight screens nobody picked a mockup for

Four screens got drawn; twelve exist. Leaving the other eight alone
would have made the app look half-migrated, which is worse than either
state on its own -- so they follow the same four rules: one container
per group, amounts in a fixed right-hand column, dividers instead of
shadows, labels left and values right.

No validation, submit flow or permission check changes here. Where a row
used to carry buttons it now carries a menu, because the row itself
became tappable.
MSG
```

---

## Task 9: 共用元件收尾

**Files:**
- Modify: `flutter_app/lib/ui/members_tab.dart`
- Modify: `flutter_app/lib/ui/settlement_history.dart`
- Modify: `flutter_app/lib/ui/category_chart.dart`
- Modify: `flutter_app/lib/ui/payment_sheet.dart`
- Modify: `flutter_app/lib/ui/confirm_dialog.dart`
- Modify: `flutter_app/lib/ui/receipt_field.dart`
- Modify: `flutter_app/lib/ui/place_field.dart`

- [ ] **Step 1: `members_tab.dart` 成員列表包成一張卡**

每個 `MemberRow` 變成 `LedgerRow`（標題是名字、副標是角色、`trailing` 是管理選單），整組包一個 `LedgerCard`。**`canManage` 的權限判斷不動。**

- [ ] **Step 2: `settlement_history.dart` 付款紀錄改列**

每筆付款一個 `LedgerRow`：標題「A 付給 B」、副標日期、金額靠右。整組包 `LedgerCard` + `LedgerStrip(title: '付款紀錄')`。

- [ ] **Step 3: `category_chart.dart` 五欄對齊**

跟 Task 7 Step 3 同一套五欄：圖示、名稱（固定 42）、長條（Expanded）、百分比（固定 32、靠右）、金額（固定 56、靠右）。

- [ ] **Step 4: `payment_sheet.dart` 與 `confirm_dialog.dart` 圓角跟上**

兩者的圓角應該已經跟著 `AppRadius.xl` 自動變了（Task 1）。這一步只確認：bottom sheet 的圓角是 14 不是 22，對話框沒有被內容撐破。**流程不動。**

- [ ] **Step 5: `receipt_field.dart` 與 `place_field.dart`**

兩者的輸入框圓角跟著 `AppRadius.md` 自動變成 8。收據的上傳區塊改成虛線框 + 圖示 + 說明一行。**`place_field.dart` 的搜尋與座標邏輯一行都不動** —— 那是上一輪 TDD 出來的，有測試釘著。

- [ ] **Step 6: analyze 與測試**

```powershell
flutter analyze
flutter test
```

Expected: analyze **1 issue**；test **397 passed**。

`place_search_test.dart` 特別要看 —— 它有 4 條，一條都不能紅。

- [ ] **Step 7: Commit**

```bash
git add flutter_app/lib/ui/members_tab.dart flutter_app/lib/ui/settlement_history.dart \
        flutter_app/lib/ui/category_chart.dart flutter_app/lib/ui/payment_sheet.dart \
        flutter_app/lib/ui/confirm_dialog.dart flutter_app/lib/ui/receipt_field.dart \
        flutter_app/lib/ui/place_field.dart
git commit -F - <<'MSG'
Finish the vocabulary so nothing is left speaking the old one

Members, payment history and the category chart were the last lists
still drawing themselves. The chart in particular had the same problem
the report did: bars that started wherever the label ended.

The sheets and dialogs needed nothing but a look -- their radii already
moved with the token in the first commit. This confirms they did, and
that place_field's search logic came through untouched, since that part
has tests holding it in place.
MSG
```

---

## Task 10: 驗收

**Files:** 可能修改上述任何檔案

- [ ] **Step 1: 自動檢查**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd <repo>\flutter_app
flutter analyze
flutter test
```

Expected: analyze **1 issue**（基線）；test **397 passed**。

- [ ] **Step 2: 掃描**

```bash
cd flutter_app
grep -rn "figureStyle" lib/ test/              # 預期：無
grep -rn "_Card" lib/ui/expense_form_page.dart # 預期：無
grep -rn "🍽\|🚗\|🏨\|🎟\|🛍\|📦" lib/           # 預期：無
grep -c "Tab(text:" lib/ui/task_page.dart      # 預期：2
grep -n "circular(18)\|circular(22)" lib/      # 預期：無（硬寫的舊圓角）
```

- [ ] **Step 3: 確認欄寬測試會失敗於錯誤實作**

拿掉 `LedgerRow` 的 `width: amountWidth`：

```powershell
flutter test test/ledger_test.dart
```

Expected: **第一條紅**，其餘綠。如果全綠，回 Task 2 修測試。

**改回來，再跑一次確認綠。**

- [ ] **Step 4: 確認對比度測試會失敗於錯誤的顏色**

把 `AppColors.rowHead` 暫時改成 `Color(0xFF8A8078)`（soft）：

```powershell
flutter test test/theme_contrast_test.dart
```

Expected: **rowHead 那兩條紅**，其餘綠。

**改回來，再跑一次確認綠。**

- [ ] **Step 5: 走查 —— 新增一筆支出**

只打名稱與金額，不捲動就能按到送出；送出後回到任務頁，那筆支出的金額、分類、日期都對。

- [ ] **Step 6: 走查 —— 鍵盤**

點名稱欄位叫出鍵盤 → 送出列被推到鍵盤正上方；收起 → 回到底部。金額、備註（多行）各試一次。

- [ ] **Step 7: 走查 —— 結算的新位置**

進任務頁不捲動就看得到「我的分攤」；點進完整結算，資料對、沒閃空白；返回後頁籤沒跑掉；找一個已結清的任務確認摘要卡不是空白。

- [ ] **Step 8: 走查 —— 對齊**

這是整輪的重點驗收。**任務列表、支出列表、報告的「花在哪」、結算摘要**四個地方，每一處的金額左緣都要在同一條垂直線上。拿手機直接看，或截圖用尺量。

- [ ] **Step 9: 走查 —— 44px 按鈕**

全 app 的按鈕都矮了 4px。並排的兩顆按鈕特別看：對話框的取消／確定、表單的查匯率、任務卡的選單。有沒有變得難按。

- [ ] **Step 10: 走查 —— 編輯與跨幣別**

編輯一筆支出：欄位帶入正確（含地點與收據），刪除鈕要捲到底才看得到，改一個欄位存檔其餘沒被改掉。選外幣：匯率在卡 1、換算是同一條上的小字、底部合計跟它一致。切「自訂」分攤：差額文字正確，合計不等於金額時送出鈕是灰的。

- [ ] **Step 11: Commit（若有修正）**

前面步驟發現並修正了東西的話各自 commit；沒有的話跳過。

---

## Self-Review

**Spec coverage：**

| Spec 章節 | 對應 Task |
|---|---|
| §2 任務頁頁籤結構 | Task 4 |
| §3.1 圓角下移 | Task 1 Step 5 |
| §3.2 rowHead / rowLine | Task 1 Step 1–4 |
| §3.3 按鈕 48 → 44 | Task 1 Step 6 |
| §3.4 figureStyle → figure() | Task 1 Step 7–8 |
| §3.5 字級不動 | 全計畫無任何字級 token 變更 |
| §4 ledger.dart 四件套 | Task 2 |
| §4.1 卡片角色改變 | Task 5 Step 2、Task 8 Step 6 |
| §4.2 金額排版五條 | Task 2 Step 3（widget 內建）＋ Task 5–9 套用 |
| §5 分類圖示 | Task 3 |
| §6 逐頁 | Task 5、6、7、8、9 |
| §7 對比度 | Task 1 Step 1–4、Task 10 Step 4 |
| §8 測試策略 | 每個 Task 的 analyze/test 步驟 ＋ Task 10 |
| §9 不做的事 | Global Constraints |
| §10 分層 | Task 順序 1→2→3→4→5-9 |
| §11 驗收 | Task 10 |

**型別一致性：**

- `figure({size, weight, color})` 在 Task 1 定義，Task 2、5、6、7 使用 —— 參數名一致。
- `LedgerRow.amountWidth`（76.0）與 `LedgerRow.iconIndent`（44.0）在 Task 2 定義，Task 4、5、8 使用。
- `LedgerCard` 吃 `children:`（複數），Task 6 Step 1 特別標注了 `_Card` 是 `child:` 單數，換的時候要改。
- `CategoryMeta.icon` 在 Task 3 從 `String` 變 `IconData`，Task 5–9 都當 `IconData` 用 —— Task 3 排在它們前面。

**已知的不確定：**

- Task 4 Step 4 的摘要卡資料來源要**讀 `settlement_tab.dart` 現有的 provider 與算法**再接。計畫沒有寫死變數名，因為寫死一個猜的名字比留白更糟。
- Task 7 Step 3 的長條 widget 名稱同理 —— 沿用現有的，不新寫。
- Task 8 Step 2 的日期分組實際位置要以 `task_page.dart` 的 `_ExpensesTab` 為準。
