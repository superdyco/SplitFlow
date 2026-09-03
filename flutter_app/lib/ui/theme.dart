/// 設計語彙。`src/assets/styles.css` 的 `:root` 那一段。
///
/// 兩個版本讀寫同一批資料、給同一群人用，看起來就該是同一個產品。
/// 顏色直接照抄，不重新調 —— 「差不多的橘色」比明顯不同更糟，
/// 那會讓人覺得哪裡怪但說不上來。
library;

import 'package:flutter/material.dart';

abstract final class AppColors {
  static const bg = Color(0xFFF2F0EC);
  static const surface = Color(0xFFFBFAF8);
  static const card = Color(0xFFFFFFFF);
  static const ink = Color(0xFF1A1613);
  /*
    灰階整條往下移一階，跟網頁版同一個做法。

    舊的 muted (#8A8078) 對頁面底色只有 3.4:1，而 textTheme.bodySmall 正是
    用它印日期、成員數與所有提示 —— 那是內文，不是裝飾，門檻是 4.5:1。

    做法不是加新顏色，是把每一階都調深：舊的 soft 退役，舊的 muted 變成
    新的 soft。階數與色相都不變，只是每一階都看得見。
  */
  static const muted = Color(0xFF6F665E); // 4.9:1 on bg。所有次要文字。
  static const soft = Color(0xFF8A8078); // 3.4:1。過得了非文字的 3:1，過不了文字的 4.5:1。
  static const line = Color(0xFFEDE7E0);
  static const lineStrong = Color(0xFFE2DCD4);
  /*
    橘色按「上面有沒有要讀的東西」拆開。primary 白字在上只有 3.6:1，
    所以它只當裝飾底（佔比條、tint、標誌）；要印字的一律用 primaryDark。

    Flutter 這邊幾乎沒有把 primary 當文字色用的地方 —— 只有 category_chart
    與 onboarding_page 兩處，而且都是色塊不是文字。所以這一輪只要確認，
    不需要像網頁版那樣做一次遷移。
  */
  static const primary = Color(0xFFE8590C);
  static const primaryDark = Color(0xFFC2410C); // 白字 5.2:1、當文字 4.6:1。
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

  /*
    列表的兩個新顏色。卡片不再一張張浮起來之後，「這是兩件事」就只剩
    這兩個東西在講：頂上的一條底色，跟中間的一條線。

    rowLine 比 line (#EDE7E0) 深一點點是刻意的 —— 它現在要承擔原本陰影
    在做的分隔工作，用一樣淺的話列表會糊成一片。
  */
  static const rowHead = Color(0xFFFAF8F5); // 列表表頭條。比 card 深、比 bg 淺。
  static const rowLine = Color(0xFFECE6DE); // 列表內的分隔線。

  /*
    danger 現在有 45 個使用者，全部是同一個正紅 —— 邊框、底、文字、按鈕
    前景都是它。網頁版已經拆成四階。

    這一輪只補常數不做遷移：把 45 處分類是另一件事，而且大多數不在這次
    動的兩個檔案裡。補一半看起來像沒做完，但反過來更糟 —— 需要
    dangerQuiet 的人發現它不存在，就會自己寫一個 Color(0xFFB8837C)，
    那才是真的回不去。

    另外記一件 test/theme_contrast_test.dart 抓到的事：danger 對頁面底色
    只有 4.10:1，對白底才有 4.66:1。**錯誤訊息只能放在白底上。**
    調深它要連網頁版一起改（那邊是同一個值），不在這一輪的範圍。
  */
  static const danger = Color(0xFFD63939);
  static const dangerLine = Color(0xFFF3D2CE);
  static const dangerSoft = Color(0xFFFFF5F5);
  static const dangerQuiet = Color(0xFFB8837C); // 平時的刪除鈕。正紅留給按下去那一刻。

  static const success = Color(0xFF0E9F6E);
  static const successSoft = Color(0xFFE6F6EF);

  static const skeleton = Color(0xFFEFEAE3);
  static const skeletonHi = Color(0xFFF7F3EE);
}

/// 圓角四階加一個藥丸。全 app 原本有 4/10/12/16/20/22 六種，
/// 其中最常用的 12 與按鈕的 16 都不在網頁版的階梯上。
abstract final class AppRadius {
  /*
    這一輪整條往下移一階：18px 的卡片圓角在密度提高之後會顯得鬆垮，
    而圓角本身不是這個方向要表達的東西。

    **只改值，不改名，不改使用點。** 四階仍是四階，不會生出沒人用的常數。
    cardTheme 已經走 AppRadius.lg，所以全 app 的卡片圓角就是這一行在管。
  */
  static const sm = 6.0; // chip、分段控制的內層、小標籤
  static const md = 8.0; // 按鈕、輸入框
  static const lg = 10.0; // 卡片
  static const xl = 14.0; // 對話框、bottom sheet
  static const pill = 999.0;
}

/// 4px 網格。全 app 原本用了 6、10、14、18、20 這些不在網格上的值。
///
/// text 那個不屬於網格：它只給同一組文字的上下兩行（標籤在上、數值在下），
/// 那是行距微調不是版面間距，硬拉到 4px 會讓標籤跟它描述的數字看起來像兩件事。
///
/// 這一輪只在動到的檔案裡用，不去掃全 app 的 SizedBox —— 那會讓 diff 大到
/// 沒人能審。
abstract final class AppSpace {
  static const text = 2.0;
  static const x1 = 4.0;
  static const x2 = 8.0;
  static const x3 = 12.0;
  static const x4 = 16.0;
  static const x6 = 24.0;
  static const x8 = 32.0;
}

ThemeData buildAppTheme() {
  /*
    secondary 這一組一定要自己給。

    Material 3 的 ChoiceChip、SegmentedButton 選中狀態用的是
    `secondaryContainer`，而不是 `primary`。只設 primary 的話它們會退回
    Material 預設的青綠色 —— 在一個橘色的 app 裡憑空冒出綠色的選中狀態，
    而且完全沒有任何警告。

    這裡把 secondary 指成同一組橘色，讓「選中」在整個 app 裡是同一個顏色。
  */
  const scheme = ColorScheme.light(
    primary: AppColors.primary,
    onPrimary: Colors.white,
    primaryContainer: AppColors.primarySoft,
    onPrimaryContainer: AppColors.primary,
    secondary: AppColors.primary,
    onSecondary: Colors.white,
    secondaryContainer: AppColors.primarySoft,
    onSecondaryContainer: AppColors.primary,
    surface: AppColors.card,
    onSurface: AppColors.ink,
    surfaceContainerHighest: AppColors.surface,
    error: AppColors.danger,
    onError: Colors.white,
    outline: AppColors.lineStrong,
    outlineVariant: AppColors.line,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.bg,

    // 網頁版用 Noto Sans TC。這裡先用系統字型 —— 打包字型檔會讓 APK 變大，
    // 而 Android 的預設中文字型本來就夠好。之後真的要對齊再說。
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.bg,
      foregroundColor: AppColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),

    cardTheme: CardThemeData(
      color: AppColors.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        side: const BorderSide(color: AppColors.line),
      ),
    ),

    /*
      44px 而不是 48：44 是 iOS 的建議下限，也過得了 WCAG 2.5.8 的 24×24。
      48 在密度提高之後顯得笨重。

      網頁版還是 48 —— 這一輪只動手機版，兩邊會不一致直到網頁版跟上。
    */
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 44),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        foregroundColor: AppColors.ink,
        side: const BorderSide(color: AppColors.line),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),

    textTheme: const TextTheme(
      // .title
      headlineSmall: TextStyle(
        fontSize: 26,
        fontWeight: FontWeight.w800,
        color: AppColors.ink,
        height: 1.3,
      ),
      // .section-title
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
      ),
      /*
        .card-head。卡片的小標，比 titleMedium 重一點但比 headlineSmall 小得多。

        網頁版加 --text-card 是因為 20 與 14 之間本來是空的，卡片標題只能在
        「太大」與「跟內文一樣」之間二選一。這裡的間隙是 26 與 16。

        字級沒有整條跟著網頁版走（那邊是 30 與 20）：顏色是身分與無障礙，
        必須一致；尺度是媒介差異，桌面 520px 容器裡的值搬到手機上會太大。
        只補中間缺的這一級。
      */
      titleSmall: TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w800,
        color: AppColors.ink,
      ),
      bodyMedium: TextStyle(fontSize: 14, color: AppColors.ink, height: 1.6),
      // .tiny
      bodySmall: TextStyle(fontSize: 12, color: AppColors.muted, height: 1.6),
    ),
  );
}

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
