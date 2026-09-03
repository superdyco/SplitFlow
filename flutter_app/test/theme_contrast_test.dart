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

  group('天氣圖示的兩個顏色', () {
    test('weatherWet 過得了圖形的 3:1', () {
      expect(
        contrastRatio(AppColors.weatherWet, AppColors.card),
        greaterThanOrEqualTo(3),
      );
    });

    /*
      這一條**斷言它過不了**，跟「soft 過不了 4.5」是同一種寫法。

      任何看起來像陽光的黃都太亮，這是物理限制不是選色失敗。它站得住是
      因為兩件事：圖示旁邊一律有文字（意義不靠它獨自承擔），而且太陽與
      閃電是實心圖示（會消失的是細線，不是色塊）。

      寫成測試是為了讓下一個人知道這是**算過之後決定的**，不是漏掉了。
      哪天有人想拿它去印文字，這條會擋住。
    */
    test('weatherSun 過不了 3:1 —— 這是刻意的，所以它只用在實心圖示上', () {
      expect(contrastRatio(AppColors.weatherSun, AppColors.card), lessThan(3));
    });
  });

  group('橘色的字配橘色的淺底', () {
    /*
      這一組是最容易不小心做出來的組合：橘字配橘底，看起來非常合理。
      三個橘色的實際數字是

        primary      3.21  ✗
        primaryDark  4.64  ✓
        primaryDeep  6.55  ✓

      **這幾個數字曾經被手算錯過**：primaryDark 一度被寫成 4.17，於是有一條
      測試斷言它「不准用」，而報告頁的每人平均為此從 primarySoft 改成白底。
      CI 跑起來才發現真值是 4.64。手算對比度不可靠，要算就用程式算。
    */
    test('primaryDark 印在 primarySoft 上過得了 AA', () {
      expect(
        contrastRatio(AppColors.primaryDark, AppColors.primarySoft),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('primary 更不能印在 primarySoft 上', () {
      expect(
        contrastRatio(AppColors.primary, AppColors.primarySoft),
        lessThan(4.5),
      );
    });

    /*
      橘色淺底上唯一過得了的橘色。頭像的字母就是這個組合 ——
      members_tab 與 onboarding_page 各有一個。
    */
    test('primaryDeep 印在 primarySoft 上過得了 AA', () {
      expect(
        contrastRatio(AppColors.primaryDeep, AppColors.primarySoft),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('primaryDark 印在白底上才過得了 AA', () {
      expect(
        contrastRatio(AppColors.primaryDark, AppColors.card),
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
