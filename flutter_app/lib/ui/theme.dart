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
  static const primary = Color(0xFFE8590C);
  static const primaryDark = Color(0xFFC2410C);
  static const primarySoft = Color(0xFFFFF0E4);
  static const danger = Color(0xFFD63939);
  static const success = Color(0xFF0E9F6E);
  static const successSoft = Color(0xFFE6F6EF);
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
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: AppColors.line),
      ),
    ),

    // 網頁版的 .btn 是 48px 高、16px 圓角。
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 48),
        foregroundColor: AppColors.ink,
        side: const BorderSide(color: AppColors.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
      bodyMedium: TextStyle(fontSize: 14, color: AppColors.ink, height: 1.6),
      // .tiny
      bodySmall: TextStyle(fontSize: 12, color: AppColors.muted, height: 1.6),
    ),
  );
}

/// 金額用等寬數字。
///
/// 不加的話一欄金額右對齊會因為數字寬度不同而抖動 —— 網頁版靠
/// `font-variant-numeric: tabular-nums`，Flutter 的等價寫法是這個。
const TextStyle figureStyle = TextStyle(
  fontSize: 22,
  fontWeight: FontWeight.w700,
  color: AppColors.ink,
  fontFeatures: [FontFeature.tabularFigures()],
);
