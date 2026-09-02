# Flutter 視覺對齊與支出表單重排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `theme.dart` 的 token 對齊網頁版（含 `muted` 那個過不了 WCAG 的無障礙缺陷），並把 `expense_form_page.dart` 的十一個平鋪欄位重分成三張卡、送出鈕固定在畫面底部。

**Architecture:** 由下而上、風險遞增。第一步是唯一測得到的東西，而且它的 TDD 有個特別的性質：**測試第一次紅不是因為函式沒實作，是因為顏色真的不合格** —— 那是缺陷驅動，不是儀式。接著補其餘 token（版面要用到圓角與間距常數），最後才動 947 行的表單，三張卡與固定送出列分兩個 commit，讓「卡片分對了」與「送出列黏對了」能分開驗。

**Tech Stack:** Flutter 3.47.1 / Dart 3.13.1、Material 3、Riverpod、`flutter test`（純函式與 widget 測試）、`flutter analyze`。

**Spec:** `docs/superpowers/specs/2026-09-03-flutter-visual-alignment-design.md`

## Global Constraints

- **只動 `flutter_app/`。** `src/`（網頁版）完全不碰。
- **Flutter 不在 PATH 上。** 每個 PowerShell 指令前都要先設好，否則 `flutter` 找不到：
  ```powershell
  $env:PATH = "C:\dev\flutter\bin;$env:PATH"
  ```
  SDK 在 `C:\dev\flutter`，版本 3.47.1。
- **`flutter analyze` 的基線是 1 issue，不是 0。** `lib/data/dictation_service.dart:97`
  的 deprecated `localeId` 是既有的，跟這次無關。**收工時仍然是 1** ——
  看到 1 不要以為是自己弄出來的，看到 2 才是。
- **`flutter test` 的基線是 380 passed。**
- **`lib/` 的行尾不一致：51 個 CRLF、41 個 LF。** `theme.dart` 是 **CRLF**，
  `expense_form_page.dart` 是 **LF**。用腳本做字串取代前**要逐檔偵測**——
  假設錯了會靜默失敗（沒有錯誤訊息，只是沒改到）。偵測方式：
  ```bash
  file lib/ui/theme.dart          # 看有沒有 "with CRLF line terminators"
  ```
- **不改任何金額計算、分攤邏輯或送出流程。** `_canSubmit`、`_customDiff`、
  `_submit`、`_delete` 的主體一律照舊。
- **不做陰影四階與卡片三身分。** 見 spec §範圍。要做得先有 `AppCard` 抽象，
  那是獨立的一件事。**記錄，不做。**
- **不動字級的 26 與 16。** 顏色是身分與無障礙必須一致；尺度是媒介差異，
  本來就該不同。只補中間缺的一級。
- **`danger` 只補常數不做遷移。** 45 處的分類是另一件事，而且大多不在這次
  動的兩個檔案裡。
- **中文註解，寫「為什麼」不寫「做了什麼」。** 跟著既有風格。
- **版面測不到。** 只有 Task 1 的對比度測得到，其餘靠 `flutter analyze`、
  編譯與人工走查。不要用「`flutter test` 全綠」當作版面改對了的證據。

### 既有型別與常數（全計畫共用，不要重新定義）

```dart
// lib/ui/theme.dart —— 現有的十四個顏色常數
abstract final class AppColors {
  static const bg = Color(0xFFF2F0EC);
  static const surface = Color(0xFFFBFAF8);
  static const card = Color(0xFFFFFFFF);
  static const ink = Color(0xFF1A1613);
  static const muted = Color(0xFF8A8078);      // ← Task 1 要改
  static const soft = Color(0xFFA39A90);       // ← Task 1 要改
  static const line = Color(0xFFEDE7E0);
  static const lineStrong = Color(0xFFE2DCD4);
  static const primary = Color(0xFFE8590C);
  static const primaryDark = Color(0xFFC2410C);
  static const primarySoft = Color(0xFFFFF0E4);
  static const danger = Color(0xFFD63939);
  static const success = Color(0xFF0E9F6E);
  static const successSoft = Color(0xFFE6F6EF);
}

ThemeData buildAppTheme();
const TextStyle figureStyle;   // 金額用的等寬數字
```

`expense_form_page.dart` 裡的 `_Field({label, hint, error, child})` 是這一頁自己的
私有 widget，十一個欄位全部包在它裡面。

### 網頁版的對應值（抄這一份，不要自己調）

```
--space-1: 4    --space-2: 8    --space-3: 12
--space-4: 16   --space-6: 24   --space-8: 32   --space-text: 2

--radius-sm: 10   --radius-md: 14   --radius-lg: 18
--radius-xl: 22   --radius-pill: 999

--text-card: 17px   （Flutter 這邊對應 titleSmall）

.field 的 gap 是 --space-2（8）；卡片內欄位之間是 --space-4（16）
```

---

## File Structure

**新增**

- `flutter_app/test/theme_contrast_test.dart` — WCAG 對比度的計算與斷言。純函式，不 import UI。

**修改**

- `flutter_app/lib/ui/theme.dart` — 灰階修正、補九個顏色、圓角四階、間距常數、補一級字級
- `flutter_app/lib/ui/expense_form_page.dart` — 三張卡、欄位順序、`_Field` 間距、固定送出列

**不修改（明確列出，避免有人順手動）**

- `src/` 任何檔案
- `flutter_app/lib/ui/place_field.dart`、`receipt_field.dart`
- `flutter_app/lib/data/dictation_service.dart`

---

## Task 1: 對比度測試與灰階修正（TDD）

`bodySmall` —— 全 app 次要文字的預設 —— 用的 `muted` 對頁面底色只有 3.4:1，
過不了 WCAG 文字的 4.5:1。這件事現在只寫在註解裡，而註解不會在有人把顏色
調亮一點的時候變紅。

**這一步的 TDD 跟平常不一樣：測試第一次紅不是因為函式沒實作，是因為顏色
真的不合格。** 先看到那個紅，再去修顏色。

**Files:**
- Create: `flutter_app/test/theme_contrast_test.dart`
- Modify: `flutter_app/lib/ui/theme.dart`

**Interfaces:**
- Consumes: `AppColors`（`lib/ui/theme.dart`）
- Produces: `contrastRatio(Color a, Color b)` — 測試檔內部的輔助函式，不匯出到 lib

- [x] **Step 1: 寫測試**

建立 `flutter_app/test/theme_contrast_test.dart`：

```dart
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:splitflow/ui/theme.dart';

/// WCAG 2.1 的相對亮度與對比度。
///
/// 公式不長，而「這個灰在這個底色上讀不讀得到」是一個有標準答案的問題 ——
/// 那種問題該讓測試回答，不是讓下一個人用眼睛猜，也不是寫在註解裡等人相信。
///
/// 放在測試檔裡而不是 lib：它只服務這些斷言，app 執行時不需要算對比度。
double _channel(int value) {
  final c = value / 255.0;
  return c <= 0.04045 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
}

double _luminance(Color color) {
  // withValues 之後 r/g/b 是 0..1 的 double，乘回 255 才是 WCAG 要的整數通道。
  final r = _channel((color.r * 255).round());
  final g = _channel((color.g * 255).round());
  final b = _channel((color.b * 255).round());
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

double contrastRatio(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  final hi = math.max(la, lb);
  final lo = math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  group('contrastRatio 本身', () {
    test('黑白是 21:1', () {
      expect(contrastRatio(Colors.black, Colors.white), closeTo(21, 0.01));
    });

    test('同色是 1:1', () {
      expect(contrastRatio(AppColors.bg, AppColors.bg), closeTo(1, 0.001));
    });

    test('順序不影響結果', () {
      expect(
        contrastRatio(AppColors.ink, AppColors.bg),
        closeTo(contrastRatio(AppColors.bg, AppColors.ink), 0.001),
      );
    });
  });

  group('文字顏色要過 4.5:1', () {
    test('muted 對頁面底色 —— 它是 bodySmall 的預設，那是內文不是裝飾', () {
      // 日期、成員數、每人金額、所有提示都印在這個顏色上。
      expect(contrastRatio(AppColors.muted, AppColors.bg),
          greaterThanOrEqualTo(4.5));
    });

    test('muted 對卡片白底', () {
      expect(contrastRatio(AppColors.muted, AppColors.card),
          greaterThanOrEqualTo(4.5));
    });

    test('ink 對頁面底色與卡片', () {
      expect(contrastRatio(AppColors.ink, AppColors.bg),
          greaterThanOrEqualTo(4.5));
      expect(contrastRatio(AppColors.ink, AppColors.card),
          greaterThanOrEqualTo(4.5));
    });

    test('danger 對頁面底色 —— 錯誤訊息是文字', () {
      expect(contrastRatio(AppColors.danger, AppColors.bg),
          greaterThanOrEqualTo(4.5));
    });

    test('primaryDark 白字在上 —— 它是按鈕底', () {
      expect(contrastRatio(Colors.white, AppColors.primaryDark),
          greaterThanOrEqualTo(4.5));
    });
  });

  group('非文字顏色', () {
    test('soft 過得了 3:1 —— 它畫的是分隔與圖示，不是字', () {
      expect(contrastRatio(AppColors.soft, AppColors.bg),
          greaterThanOrEqualTo(3.0));
    });

    test('soft 過不了 4.5 —— 這一條是刻意的', () {
      // 它把「這個顏色不是給文字用的」從註解變成機器讀得懂的規則。
      // 有人拿 soft 去印一行說明時，這裡會擋下來。
      expect(contrastRatio(AppColors.soft, AppColors.bg), lessThan(4.5));
    });

    test('primary 只當裝飾底 —— 白字在上過不了 4.5，所以它不該印字', () {
      // 網頁版那一輪把所有橘色文字改成 primaryDark 就是因為這一條。
      expect(contrastRatio(Colors.white, AppColors.primary), lessThan(4.5));
    });
  });
}
```

> **`Color` 的 API 在新版 Flutter 變了。** `color.red` / `.green` / `.blue`
> 已經 deprecated，取而代之的是 `.r` / `.g` / `.b`，而且**回傳 0..1 的 double
> 不是 0..255 的 int**。上面的 `_luminance` 已經照新 API 寫。如果 analyze
> 對這幾行有意見，看它要的是哪一種，**不要兩種混用**。

- [x] **Step 2: 跑測試，確認紅的是顏色不是編譯**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd D:\project\SplitFlow\flutter_app
flutter test test/theme_contrast_test.dart
```

Expected: **四條失敗**（實測結果，2026-09-03）：

| 失敗的斷言 | 實際值 |
|---|---|
| muted 對頁面底色 | 3.39 |
| muted 對卡片白底 | 3.86 |
| soft 過得了 3:1 | 2.43 |
| **danger 對頁面底色** | **4.10** |

前三條 Step 3 改完就綠。**第四條是計畫沒料到的**：`danger` 對頁面底色
過不了，而網頁版用同一個值。處理方式見 spec §4.1 —— 斷言改成只守白底，
並把「錯誤文字只能放在白底上」寫成規則，那決定了 Task 4 的固定列背景。

**如果紅的是編譯錯誤，那是 `Color` API 的問題，先解決它 ——
那不是這一步要看的紅。**

**這兩條紅就是這個計畫存在的理由。** 看到數字再往下走。

- [x] **Step 3: 灰階整條往下移一階**

改 `lib/ui/theme.dart`（**這個檔案是 CRLF**）：

```dart
  static const muted = Color(0xFF8A8078);
  static const soft = Color(0xFFA39A90);
```

改成：

```dart
  /*
    灰階整條往下移一階，跟網頁版同一個做法。

    舊的 muted (#8A8078) 對頁面底色只有 3.4:1，而 textTheme.bodySmall 正是
    用它印日期、成員數與所有提示 —— 那是內文，不是裝飾，門檻是 4.5:1。

    做法不是加新顏色，是把每一階都調深：舊的 soft 退役，舊的 muted 變成
    新的 soft。階數與色相都不變，只是每一階都看得見。
  */
  static const muted = Color(0xFF6F665E); // 4.9:1 on bg。所有次要文字。
  static const soft = Color(0xFF8A8078); // 3.4:1。過得了非文字的 3:1，過不了文字的 4.5:1。
```

- [x] **Step 4: 跑測試確認全綠**

```powershell
flutter test test/theme_contrast_test.dart
```

Expected: PASS，11 個案例全綠。

- [x] **Step 5: 全套測試與 analyze**

```powershell
flutter test
flutter analyze
```

Expected: `flutter test` 是 380 + 11 = **391 passed**。
`flutter analyze` 仍然是 **1 issue**（那個既有的 deprecated）。

- [x] **Step 6: Commit**

```bash
git add flutter_app/test/theme_contrast_test.dart flutter_app/lib/ui/theme.dart
git commit -m "Make the grey that fails WCAG something a test can catch

textTheme.bodySmall 用的 muted 是 #8A8078，對頁面底色 3.4:1 —— 過不了
WCAG 文字的 4.5:1。日期、成員數、每人金額、所有提示都印在這個顏色上。

諷刺的是 #8A8078 正是網頁版那一輪把灰階整條調深之後、退居非文字用途的
那一階。Flutter 抄的是調整前的值。

灰階整條往下移一階：舊的 soft 退役，舊的 muted 變成新的 soft，階數與
色相都不變。

順手把對比度寫成測試。WCAG 的相對亮度是純函式，Dart 算得出來 ——
「這個灰在這個底色上讀不讀得到」有標準答案，不該讓下一個人用眼睛猜。
最重要的一條是 soft 同時斷言「過得了 3:1」與「過不了 4.5:1」：它把
「這個顏色不是給文字用的」從註解變成機器讀得懂的規則。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 其餘的 token（補色、圓角、間距、字級）

Task 3 與 Task 4 要用到圓角與間距常數，所以先補齊。

**Files:**
- Modify: `flutter_app/lib/ui/theme.dart`

- [x] **Step 1: 補九個顏色常數**

在 `AppColors` 裡補上網頁版有、這邊沒有的。放在對應的既有常數旁邊，
不要全部堆在最後：

```dart
  static const primary = Color(0xFFE8590C);
  static const primaryDark = Color(0xFFC2410C);
  /// primaryDark 升格成靜止色之後空出來的按下狀態。
  static const primaryDeep = Color(0xFF9A3412);
  static const primarySoft = Color(0xFFFFF0E4);

  /*
    佔比條的三階明度。同色相分段，不引入新色相 —— 條子上不放文字，
    所以這三個不受對比度門檻約束。
  */
  static const primaryB1 = Color(0xFFE8590C);
  static const primaryB2 = Color(0xFFF0A072);
  static const primaryB3 = Color(0xFFF7D3BD);

  /// 頁籤與分段控制的底槽，比頁面底色再深一階。
  static const track = Color(0xFFF0EBE4);

  static const danger = Color(0xFFD63939);
  /*
    danger 現在有 45 個使用者，全部是同一個正紅 —— 邊框、底、文字、
    按鈕前景都是它。網頁版已經拆成四階。

    這一輪只補常數不做遷移：把 45 處分類是另一件事，而且大多數不在這次
    動的兩個檔案裡。補一半看起來像沒做完，但反過來更糟 —— 需要
    dangerQuiet 的人發現它不存在，就會自己寫一個 Color(0xFFB8837C)，
    那才是真的回不去。
  */
  static const dangerLine = Color(0xFFF3D2CE);
  static const dangerSoft = Color(0xFFFFF5F5);
  static const dangerQuiet = Color(0xFFB8837C); // 平時的刪除鈕。正紅留給按下去那一刻。

  static const skeleton = Color(0xFFEFEAE3);
  static const skeletonHi = Color(0xFFF7F3EE);
```

> **會多出 unused 警告嗎？** 不會 —— `abstract final class` 的 static 常數
> 沒有使用者不算 unused。Step 5 會確認 analyze 還是 1 issue。

- [x] **Step 2: 圓角四階**

在 `AppColors` 後面新增：

```dart
/// 圓角四階加一個藥丸。全 app 原本有 4/10/12/16/20/22 六種，
/// 其中最常用的 12 與按鈕的 16 都不在網頁版的階梯上。
abstract final class AppRadius {
  static const sm = 10.0;
  static const md = 14.0;
  static const lg = 18.0;
  static const xl = 22.0;
  static const pill = 999.0;
}
```

- [x] **Step 3: 間距常數**

```dart
/// 4px 網格。全 app 原本用了 6、10、14、18、20 這些不在網格上的值。
///
/// text 那個不屬於網格：它只給同一組文字的上下兩行（標籤在上、數值在下），
/// 那是行距微調不是版面間距，硬拉到 4px 會讓標籤跟它描述的數字看起來像兩件事。
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

> **這一輪只定義、只在動到的檔案裡用。** 不要去掃全 app 的 `SizedBox` ——
> 那是第三輪的事，而且會讓這次的 diff 大到沒人能審。

- [x] **Step 4: 補一級字級，並把圓角套進去**

`textTheme` 補上 `titleSmall`：

```dart
      // .card-head。20 與 14 之間本來是空的，卡片小標只能在「太大」與
      // 「跟內文一樣」之間二選一。
      titleSmall: TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w800,
        color: AppColors.ink,
      ),
```

`cardTheme` 與兩個 buttonTheme 的硬寫圓角換成常數：

```dart
    cardTheme: CardThemeData(
      // ...
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.lg),   // 20 → 18
        side: const BorderSide(color: AppColors.line),
      ),
    ),
```

`filledButtonTheme` 與 `outlinedButtonTheme` 的 `circular(16)` → `circular(AppRadius.md)`（14）。

那兩個 theme 上方的註解也要改 —— 它現在寫著「網頁版的 .btn 是 48px 高、
16px 圓角」，而網頁版現在是 14。

- [x] **Step 5: analyze 與測試**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd D:\project\SplitFlow\flutter_app
flutter analyze
flutter test
```

Expected: analyze **1 issue**（基線），test **391 passed**。

- [x] **Step 6: 目視確認圓角沒有跑掉**

跑起來看任務列表與任何一個對話框：卡片與按鈕的圓角應該**略小**於之前
（20→18、16→14），但不該有任何一個角看起來是方的或過圓。

```powershell
flutter run
```

> 沒有裝置或模擬器的話這一步跳過，但**要在 commit 訊息裡說沒目視過**。

- [x] **Step 7: Commit**

```bash
git add flutter_app/lib/ui/theme.dart
git commit -m "Give the theme the tokens the web version has had for two rounds

補上網頁版有、這邊沒有的九個顏色：primaryDeep、佔比條三階、track、
danger 的三階、skeleton 兩階。圓角六種收成四階，間距定成 4px 網格，
字級補上 17px 那一級 —— 20 與 14 之間本來是空的，卡片小標只能在
「太大」與「跟內文一樣」之間二選一。

danger 只補常數不做遷移，理由寫在常數旁邊：45 處的分類是另一件事。

間距與圓角常數這一輪只在動到的檔案裡用，不掃全 app 的 SizedBox ——
那會讓 diff 大到沒人能審。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 支出表單三張卡

十一個 `_Field` 平鋪在一個 `Column` 裡，而 `_canSubmit` 只要求名稱與金額。
跟網頁版改版前同構。

**Files:**
- Modify: `flutter_app/lib/ui/expense_form_page.dart`（**這個檔案是 LF，不是 CRLF**）

### 3.0 目標結構

```
卡 1（主卡，沒有小標）
  分類 chips          ← 從第二個搬到第一個
  支出名稱（含語音）
  金額 ＋ 幣別
  匯率（跨幣別時）＋ 換算後金額

卡 2「這趟的細節」
  日期與時間
  地點
  收據
  備註

卡 3「怎麼分」
  誰先付的
  分攤方式（SegmentedButton）
  分攤成員／每人金額
```

三個刻意的安排，**改的時候不要「順手優化」掉**：

- **匯率留在卡 1。** 它是「多少錢」的一部分。
- **分類排到最上面。** 它不是必填，但先按一下分類，名稱要打什麼通常也就
  想好了；而且手指從分類滑到名稱是連續動作。
- **「誰先付的」放卡 3。** 它預設是自己，概念上屬於「這筆錢怎麼算」。

**不要改成依主題分的四張卡。** 卡片的 padding 是有成本的，總高度會比現在更長 ——
而縮短捲動距離正是目標。

- [ ] **Step 1: 先確認行尾**

```bash
file flutter_app/lib/ui/expense_form_page.dart
```

Expected: **沒有** "CRLF" —— 這個檔案是 LF。用腳本取代時樣板字串直接用 `\n`。
（`theme.dart` 是 CRLF，兩個檔案不一樣，不要沿用上一個 Task 的做法。）

- [ ] **Step 2: 加一個 `_Card` 私有 widget**

放在 `_Field` 旁邊：

```dart
/// 一張卡，帶一個可選的小標。
///
/// 十一個欄位平鋪時每個東西的視覺重量都一樣，所以真正必填的那兩個沒有重量。
/// 分組依「你會不會動它」而不是依主題 —— 依主題要四張卡，而卡片的 padding
/// 是有成本的，總高度會比平鋪更長，那是反方向。
///
/// 主卡不給小標：它是主角，不需要一個標題來宣告自己是主角。
class _Card extends StatelessWidget {
  final String? title;
  final List<Widget> children;

  const _Card({this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.x4),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpace.x4, AppSpace.x4, AppSpace.x4, AppSpace.x1),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (title != null) ...[
                Text(title!, style: text.titleSmall),
                const SizedBox(height: AppSpace.x4),
              ],
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}
```

> **底部 padding 是 `x1` 不是 `x4`，那是刻意的：** 每個 `_Field` 自己帶
> `bottom: 20`（Step 3 改成 16），所以卡片最後一個欄位下面已經有間距了。
> 兩邊都給 16 的話卡片底部會空出 32。**做完目視確認這一條對不對，
> 不對就調成 `EdgeInsets.all(AppSpace.x4)` 並把 `_Field` 最後一個的 padding 拿掉。**

- [ ] **Step 3: `_Field` 的三個間距對齊網格**

`_Field` 現在是 `bottom: 20` / `SizedBox(height: 6)` / `top: 4`。
網頁版的 `.field` gap 是 8，卡片內欄位之間是 16。

```dart
      padding: const EdgeInsets.only(bottom: 20),
```
→
```dart
      padding: const EdgeInsets.only(bottom: AppSpace.x4),
```

```dart
          const SizedBox(height: 6),
```
→
```dart
          const SizedBox(height: AppSpace.x2),
```

兩處 `EdgeInsets.only(top: 4)` → `EdgeInsets.only(top: AppSpace.x2)`。

> 20 與 6 都不在 4px 網格上；4 在網格上但網頁版的 `.field` 是統一的 8。

- [ ] **Step 4: 把十一個欄位包進三張卡**

`SingleChildScrollView` 的 `Column.children` 從十一個 `_Field` 加尾巴，
改成三個 `_Card`。

**卡 1** —— 注意分類要搬到名稱前面：

```dart
                  _Card(children: [
                    _Field(label: '分類', child: /* 原本的 Wrap + ChoiceChip */),
                    _Field(label: '支出名稱', child: /* 原本的 _TitleField */),
                    _Field(label: '金額', hint: ..., error: amountErr, child: /* 原本的 Row */),
                    if (needsRate) _Field(label: '匯率（...）', ...),
                  ]),
```

**卡 2**：

```dart
                  _Card(title: '這趟的細節', children: [
                    _Field(label: '日期與時間', child: ...),
                    _Field(label: '地點（選填）', hint: ..., child: PlaceField(...)),
                    _Field(label: '收據（選填）', hint: ..., child: ReceiptField(...)),
                    _Field(label: '備註（選填）', child: ...),
                  ]),
```

**卡 3**：

```dart
                  _Card(title: '怎麼分', children: [
                    _Field(label: '誰先付的', child: ...),
                    _Field(label: '怎麼分', child: /* SegmentedButton + 成員 */),
                  ]),
```

> **卡 3 的小標與裡面那個 `_Field` 的 label 都叫「怎麼分」，重複了。**
> 把 `_Field` 的 label 改成 **「分攤方式」**（跟網頁版一致），小標維持「怎麼分」。

`_error`、`FilledButton`、刪除鈕暫時留在三張卡後面不動 —— Task 4 才處理。

- [ ] **Step 5: 換算後金額併進匯率那一格**

現在它是一個獨立的 `Padding`，浮在 `_Field` 外面：

```dart
                  if (base != null && needsRate)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text('換算後 ${task.defaultCurrency} ...'),
                    ),
```

搬進匯率 `_Field` 的 child，變成輸入列下面的一行小字：

```dart
                    if (needsRate)
                      _Field(
                        label: '匯率（1 $_currency = ? ${task.defaultCurrency}）',
                        hint: _rateUpdatedAt.isEmpty
                            ? '匯率在記帳當下鎖住，之後波動不影響這筆帳'
                            : '更新於 $_rateUpdatedAt',
                        error: rateErr ?? _rateError,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(/* 原本的輸入框 + 查匯率鈕 */),
                            if (base != null) ...[
                              const SizedBox(height: AppSpace.x2),
                              // 網頁版壓成 ≈ TWD 672 一行，這裡照同一個做法。
                              Text(
                                '≈ ${task.defaultCurrency} '
                                '${formatAmount(base, task.defaultCurrency)}',
                                style: text.bodySmall,
                              ),
                            ],
                          ],
                        ),
                      ),
```

> **`base` 的計算位置要看一眼。** 它現在算在 `build` 裡、`if (base != null && needsRate)`
> 那一段之前。搬進 `_Field` 之後 `needsRate` 已經是外層條件，所以裡面只要
> 判斷 `base != null`。**不要動 `base` 怎麼算的。**

- [ ] **Step 6: analyze 與測試**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd D:\project\SplitFlow\flutter_app
flutter analyze
flutter test
```

Expected: analyze **1 issue**（基線），test **391 passed**。

- [ ] **Step 7: 目視走一遍**

```powershell
flutter run
```

- 三張卡，卡 1 沒有小標，卡 2、卡 3 有
- **分類在名稱上面**
- 選一個外幣 → 匯率在卡 1 裡，換算後金額是輸入列下面的一行 `≈` 小字
- 卡片底部沒有空出過多的留白（見 Step 2 的註記）
- 次要文字（label、hint）明顯比之前清楚 —— 那是 Task 1 的成果

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/ui/expense_form_page.dart
git commit -m "Give the two required fields a card of their own

十一個欄位平鋪在一個 Column 裡，而 _canSubmit 只要求兩個 —— 名稱與金額。
每個東西的視覺重量都一樣，所以真正重要的那兩個沒有重量。網頁版昨天
才修掉同一個病，理由在手機上只會更強：記帳常常是在餐廳裡站著單手做的。

分成三張卡，依「你會不會動它」而不是依主題。依主題要四張卡，而卡片的
padding 是有成本的 —— 總高度會比平鋪更長，那是反方向。

分類搬到名稱前面，跟網頁版一致：先按一下分類，名稱要打什麼通常也就
想好了，而且手指從分類滑到名稱是連續動作。

換算後金額從浮在欄位外的一塊併進匯率那一格，變成輸入列下面的一行 ≈ 小字。
_Field 的 20/6/4 三個間距對齊 4px 網格。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 固定送出列

最後做，因為它動的是頁面骨架。

### 4.0 Flutter 這邊比網頁版簡單

網頁版為了這件事要用 `position: sticky`，並且處理 iOS Safari 虛擬鍵盤把
`fixed` 元素頂歪的問題。Flutter 沒有這個問題：

**`Scaffold.bottomNavigationBar` 加上預設的 `resizeToAvoidBottomInset: true`，
鍵盤跳出來時 body 會縮、那一列會被推到鍵盤正上方。** 框架直接管理 view
insets，不是靠 CSS 猜。

所以這一項在 Flutter 是**用對元件**，不是 workaround。

### 4.1 只有送出鈕與錯誤訊息進去

錯誤必須跟著進去：送出失敗時 `_error` 會被設值，如果它印在捲動流底部而
使用者停在上面，他會按了送出、什麼都沒發生、也不知道為什麼。

### 4.2 刪除留在捲動流裡

**這條不能妥協。** 網頁版的 `93be088`（*Stop putting the destructive button
under the thumb*）講的就是手機：系統對話框「OK 落在哪不是我們能決定的，
而它傾向落在拇指下」。固定在螢幕底部的那一列就是拇指的定位點。

附加好處：刪除需要刻意捲下去才找得到 —— 那正是它應得的摩擦。

- [ ] **Step 1: 送出鈕與錯誤搬進 `bottomNavigationBar`**

`Scaffold` 現在是：

```dart
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? '編輯支出' : '新增支出')),
      body: task == null ? ... : SingleChildScrollView(...),
    );
```

改成：

```dart
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? '編輯支出' : '新增支出')),
      body: task == null ? ... : SingleChildScrollView(...),
      /*
        送出鈕固定在畫面底部。記帳常常是在餐廳裡站著單手做的，而它原本在
        十一個區塊之後。

        用 bottomNavigationBar 而不是把它塞進捲動流的底部：
        resizeToAvoidBottomInset 預設是 true，鍵盤跳出來時 body 會縮、
        這一列會被推到鍵盤正上方。這是框架直接管 view insets ——
        網頁版為了同一件事得用 sticky 再繞開 iOS Safari 的鍵盤行為。

        錯誤訊息跟著進來：不然送出失敗時使用者停在表單上方，訊息印在
        捲動流底部，他會按了送出、什麼都沒發生、也不知道為什麼。

        SafeArea 是必要的（iPhone 底部那條橫槓），背景色也是 ——
        預設透明的話下面的欄位會直接穿過去。

        背景用 card（白）不用 bg：錯誤訊息印在這一列上，而 danger 對頁面
        底色只有 4.10:1、對白底才有 4.66:1。這是 Task 1 的對比度測試逼出來
        的結論，不是配色偏好。
      */
      bottomNavigationBar: task == null || blocked
          ? null
          : Container(
              color: AppColors.card,
              child: SafeArea(
                minimum: const EdgeInsets.fromLTRB(
                    AppSpace.x4, AppSpace.x2, AppSpace.x4, AppSpace.x2),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_error != null) ...[
                      Text(
                        _error!,
                        style: text.bodySmall?.copyWith(color: AppColors.danger),
                      ),
                      const SizedBox(height: AppSpace.x2),
                    ],
                    FilledButton(
                      onPressed: (_saving || !_canSubmit(task, selectable))
                          ? null
                          : () => _submit(task, selectable),
                      child: Text(_saving ? '儲存中...' : '儲存'),
                    ),
                  ],
                ),
              ),
            ),
    );
```

> **`task`、`blocked`、`selectable`、`text` 這幾個變數的作用域要看一眼。**
> 它們現在算在 `build` 的前半段；`bottomNavigationBar` 跟 `body` 同層，
> 所以拿得到。但 `task` 是 nullable，**`bottomNavigationBar` 的 null 判斷
> 不能省** —— 讀取中或沒權限時不該有一列送出鈕。

- [ ] **Step 2: 捲動流裡刪掉搬走的兩塊，刪除鈕留下**

原本的尾巴：

```dart
                  if (_error != null) ...[
                    Text(_error!, style: ...),
                    const SizedBox(height: 12),
                  ],
                  FilledButton(
                    onPressed: ...,
                    child: Text(_saving ? '儲存中...' : '儲存'),
                  ),
                  if (_isEdit) ...[
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: _saving ? null : _delete,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.danger,
                      ),
                      child: const Text('刪除這筆支出'),
                    ),
                  ],
```

改成：

```dart
                  /*
                    刪除留在捲動流裡，不進固定列。網頁版的 93be088 講的就是
                    手機：系統對話框的 OK 落在哪不是我們能決定的，而它傾向
                    落在拇指下 —— 螢幕底部那一列就是拇指的定位點，不可逆的
                    操作不該常駐在那裡。

                    附帶好處：刪除需要刻意捲下去才找得到，那正是它應得的摩擦。
                  */
                  if (_isEdit)
                    OutlinedButton(
                      onPressed: _saving ? null : _delete,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.danger,
                      ),
                      child: const Text('刪除這筆支出'),
                    ),
```

- [ ] **Step 3: 捲動區底部留白**

`SingleChildScrollView` 的 padding 現在是 `fromLTRB(16, 8, 16, 32)`。
最後一個元素（編輯時是刪除鈕，新增時是卡 3）不該被固定列蓋住 ——
但 `bottomNavigationBar` 本來就不會蓋住 body（Scaffold 會把 body 的高度扣掉），
所以**這一步大概不用改**。

換成常數並確認：

```dart
              padding: const EdgeInsets.fromLTRB(
                  AppSpace.x4, AppSpace.x2, AppSpace.x4, AppSpace.x8),
```

> **目視確認捲到底時最後一個元素完整可見。** 如果被蓋住，那代表
> `bottomNavigationBar` 的高度沒有被算進去 —— 那會是別的問題，先查再加 padding。

- [ ] **Step 4: analyze 與測試**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd D:\project\SplitFlow\flutter_app
flutter analyze
flutter test
```

Expected: analyze **1 issue**（基線），test **391 passed**。

- [ ] **Step 5: 目視驗證（要有裝置或模擬器）**

```powershell
flutter run
```

1. **不捲動就能送出**：只打名稱與金額，送出鈕就在畫面底部
2. **捲動過程中送出鈕一直看得到**
3. **叫出鍵盤時送出列被推到鍵盤正上方**，沒有被蓋住、也沒有消失 ——
   這是選 `bottomNavigationBar` 的整個理由
4. **捲到最底時最後一個元素完整可見**
5. **編輯模式下刪除鈕要捲到底才看得到**，不在固定列裡
6. **送出失敗時錯誤出現在固定列裡**（把網路關掉試）
7. **讀取中與沒權限時沒有那一列**（`_Blocked` 畫面底部不該有送出鈕）

> 第 3 項是這一步的重點。沒有裝置的話**要在 commit 訊息裡說沒驗過** ——
> 不要因為 analyze 過了就宣稱鍵盤行為是對的。

- [ ] **Step 6: Commit**

```bash
git add flutter_app/lib/ui/expense_form_page.dart
git commit -m "Put the submit button where the thumb already is

記帳常常是在餐廳裡站著單手做的，而送出鈕在十一個區塊之後。

用 bottomNavigationBar 而不是把它塞進捲動流底部：resizeToAvoidBottomInset
預設是 true，鍵盤跳出來時 body 會縮、那一列會被推到鍵盤正上方。框架直接
管 view insets —— 網頁版為了同一件事得用 sticky 再繞開 iOS Safari 把
fixed 元素頂歪的行為。這一項在 Flutter 是用對元件，不是 workaround。

錯誤訊息跟著進去，不然按了送出、沒反應、也不知道為什麼。

刪除留在捲動流裡。網頁版的 93be088 講的就是手機：系統對話框的 OK 落在哪
不是我們能決定的，而它傾向落在拇指下 —— 螢幕底部那一列就是拇指的定位點。
附帶好處是刪除要刻意捲下去才找得到。

讀取中與沒權限時不給那一列：那兩個畫面上沒有東西可以送出。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 驗收

**Files:** 可能修改 `flutter_app/lib/ui/theme.dart`、`flutter_app/lib/ui/expense_form_page.dart`

- [ ] **Step 1: 自動檢查**

```powershell
$env:PATH = "C:\dev\flutter\bin;$env:PATH"
cd D:\project\SplitFlow\flutter_app
flutter analyze
flutter test
```

Expected: analyze **1 issue**（基線，不是 0）；test **391 passed**（380 + 11）。

- [ ] **Step 2: 掃描**

```bash
cd flutter_app
grep -n "0xFF8A8078" lib/ui/theme.dart      # 預期：1，而且是 soft 不是 muted
grep -c "_Card(" lib/ui/expense_form_page.dart   # 預期：4（宣告 1 + 使用 3）
grep -n "circular(12)\|circular(20)\|circular(16)" lib/ui/theme.dart  # 預期：無
grep -n "bottomNavigationBar" lib/ui/expense_form_page.dart  # 預期：1
```

- [ ] **Step 3: 確認對比度測試會失敗於錯誤的顏色**

驗收裡最容易造假的一項。把 `muted` 暫時改回 `Color(0xFF8A8078)`：

```powershell
flutter test test/theme_contrast_test.dart
```

Expected: **「muted 對頁面底色」與「muted 對卡片白底」兩條紅**，其餘綠。
如果全綠，測試沒測到該測的東西，回 Task 1 修測試。

**改回來，再跑一次確認綠。**

- [ ] **Step 4: 走查 —— 新增一筆支出**

- 只打名稱與金額，**不捲動**就能按到送出
- 送出後回到任務頁，那筆支出的金額、分類、日期都對

- [ ] **Step 5: 走查 —— 鍵盤**

- 點名稱欄位叫出鍵盤 → **送出列被推到鍵盤正上方**
- 收起鍵盤 → 送出列回到畫面底部
- 點金額、備註（多行）各試一次

- [ ] **Step 6: 走查 —— 編輯一筆支出**

- 所有欄位帶入正確（含地點與收據）
- **刪除鈕要捲到底才看得到**，不在固定列裡
- 改一個欄位存檔，其餘欄位沒有被改掉

- [ ] **Step 7: 走查 —— 跨幣別與自訂分攤**

- 選外幣 → 匯率在卡 1，換算後金額是它下面的一行 `≈` 小字
- 切到「自訂」→ 差額文字正確；合計不等於金額時送出鈕是灰的

- [ ] **Step 8: 走查 —— 對比度的實際效果**

任務列表與支出列表上的日期、成員數、每人金額 —— 那些 `bodySmall` 的文字
應該**明顯比之前清楚**。這是這一輪唯一使用者真的感覺得到的改動。

- [ ] **Step 9: Commit（若有修正）**

若前面步驟發現並修正了東西，各自 commit；沒有的話這一步跳過。

---

## Self-Review

**Spec coverage：**

| Spec 章節 | 對應 Task |
|---|---|
| §1.1 muted 的對比度 | Task 1 |
| §1.2 定義了卻沒用的三個 | Task 1（soft）+ Task 2（primaryDark 確認、successSoft 保留） |
| §1.3 要補的顏色 | Task 2 Step 1 |
| §1.4 圓角四階 | Task 2 Step 2、Step 4 |
| §1.5 間距常數 | Task 2 Step 3 + Task 3 Step 3 |
| §1.6 字級只補一級 | Task 2 Step 4 |
| §2.1 三張卡分組 | Task 3 Step 2、Step 4 |
| §2.2 欄位順序改一處 | Task 3 Step 4 |
| §2.3 換算後金額併進匯率 | Task 3 Step 5 |
| §2.4 為什麼不是四張卡 | Task 3 §3.0 |
| §3.1 bottomNavigationBar | Task 4 §4.0、Step 1 |
| §3.2 只有送出與錯誤進去 | Task 4 Step 1 |
| §3.3 刪除留在捲動流 | Task 4 Step 2 |
| §3.4 捲動區底部留白 | Task 4 Step 3 |
| §4 對比度測試 | Task 1 Step 1 |
| §5 會動到的檔案 | File Structure |
| §6 環境與基線 | Global Constraints |
| §7.1 自動 | Task 5 Step 1、Step 3 |
| §7.2 掃描 | Task 5 Step 2 |
| §7.3 人工 | Task 5 Step 4-8 |

沒有未涵蓋的章節。

**已知的計畫層級風險：**

1. **`Color` 的 API 在新版 Flutter 換過。** `.red`/`.green`/`.blue` 已 deprecated，
   `.r`/`.g`/`.b` 回傳的是 0..1 的 double 不是 0..255 的 int。Task 1 Step 1 的
   `_luminance` 照新 API 寫，但**如果 analyze 有意見，先看它要哪一種，
   不要兩種混用**。這是這個計畫唯一可能卡住的技術點。

2. **Task 3 Step 2 的卡片內距有一個要現場判斷的地方。** `_Card` 底部給 `x1`
   是因為每個 `_Field` 自己帶 `bottom: 16`；如果目視發現卡片底部太擠或太空，
   計畫給了替代寫法。**要真的看一眼，不要照抄。**

3. **`bottomNavigationBar` 會不會蓋住 body 的最後一個元素。** 照理不會
   （Scaffold 會扣掉高度），Task 4 Step 3 因此寫「大概不用改」。
   **如果目視發現被蓋住，先查為什麼，不要直接加 padding 蓋過去** ——
   那通常代表別的地方寫錯了。

4. **鍵盤那一項（Task 4 Step 5 第 3 點）是選 `bottomNavigationBar` 的整個理由，
   而它只有在真的裝置或模擬器上才驗得到。** 沒有的話要在 commit 訊息裡誠實
   說明，不要因為 analyze 過了就宣稱鍵盤行為是對的。

5. **Task 3 與 Task 4 動的是同一個 `build` 的相鄰區域。** 分成兩個 commit 是為了
   讓「卡片分對了」與「送出列黏對了」能分開驗。Task 3 結束時送出鈕還在捲動流
   最底，那是預期的中間狀態，**不要在 Task 3 就順手把它搬走**。

6. **`danger` 補了常數卻沒有使用者。** Task 2 之後 `dangerLine`、`dangerSoft`、
   `dangerQuiet`、`skeleton`、`skeletonHi`、`primaryB1-3`、`track`、`primaryDeep`
   全都是零使用者的常數。那是刻意的（理由寫在常數旁邊），**不要在驗收時
   把它們當成漏掉的工作**。
