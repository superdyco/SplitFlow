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
  return c <= 0.04045
      ? c / 12.92
      : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
}

double _luminance(Color color) {
  // r/g/b 現在是 0..1 的 double，乘回 255 才是 WCAG 要的整數通道。
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
      expect(
        contrastRatio(AppColors.muted, AppColors.bg),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('muted 對卡片白底', () {
      expect(
        contrastRatio(AppColors.muted, AppColors.card),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('ink 對頁面底色與卡片', () {
      expect(
        contrastRatio(AppColors.ink, AppColors.bg),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        contrastRatio(AppColors.ink, AppColors.card),
        greaterThanOrEqualTo(4.5),
      );
    });

    /*
      danger 只斷言白底，不斷言頁面底色 —— 因為它對頁面底色**過不了**。

      #D63939 對 card(#FFF) 是 4.66、對 surface 是 4.47、對 bg(#F2F0EC) 只有
      4.10。網頁版用的是同一個值，所以那邊也一樣。

      這條測試是寫出來的第一天就抓到的，而且它直接決定了固定送出列的背景
      要用 card 不用 bg：錯誤訊息印在那一列上，底色選錯就讀不到。

      不順手把紅色調深（#C92A2A 對 bg 是 4.79）是因為那要同時改網頁版才
      保持得住「同一個產品」，範圍超出這一輪。**記錄，不做。**
    */
    test('danger 在白底上 —— 錯誤訊息只能放在卡片或白色的列上', () {
      expect(
        contrastRatio(AppColors.danger, AppColors.card),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('primaryDark 白字在上 —— 它是按鈕底', () {
      expect(
        contrastRatio(Colors.white, AppColors.primaryDark),
        greaterThanOrEqualTo(4.5),
      );
    });
  });

  group('非文字顏色', () {
    test('soft 過得了 3:1 —— 它畫的是分隔與圖示，不是字', () {
      expect(
        contrastRatio(AppColors.soft, AppColors.bg),
        greaterThanOrEqualTo(3.0),
      );
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
