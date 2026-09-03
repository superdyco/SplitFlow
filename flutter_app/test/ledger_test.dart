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

  testWidgets('金額欄每一列一樣寬、起點一樣 —— 這就是「對齊成一欄」', (tester) async {
    /*
      量的是**欄位**，不是欄位裡的字。這一條踩過兩個坑，都寫下來：

      量文字的左緣沒有用。金額右對齊，所以「1,250」與「640」的左緣本來就
      差一個字寬 —— 這條測試原本就是這樣寫的，它一度會過，只因為那時金額
      是唯一的子項、剛好被撐滿整個盒子。後來欄位下面多了一行幣別，變成
      Column（子項各自縮到內容寬度），左緣就再也對不齊了。畫面沒壞，
      是測試量錯了東西 —— 而它從來沒被執行過，所以沒人發現。

      量文字的右緣也沒有用。就算把 amountWidth 拿掉，那一欄還是會被
      Expanded 擠到最右邊，右緣照樣對齊 —— 那條測試永遠是綠的。

      固定寬度真正買到的是「標題與金額的分界每一列都在同一個 x」，
      所以要量的就是那一欄的左緣與寬度。
    */
    await tester.pumpWidget(
      wrap(
        const LedgerCard(
          children: [
            LedgerRow(title: '晚餐', amount: '1,250'),
            LedgerRow(title: '機場快線', amount: '640'),
          ],
        ),
      ),
    );

    final slots = find.byKey(LedgerRow.amountKey);
    expect(slots, findsNWidgets(2));

    final first = tester.getRect(slots.at(0));
    final second = tester.getRect(slots.at(1));

    expect(second.left, closeTo(first.left, 0.01));
    expect(first.width, LedgerRow.amountWidth);
    expect(second.width, LedgerRow.amountWidth);
  });

  testWidgets('金額用等寬數字', (tester) async {
    await tester.pumpWidget(
      wrap(
        const LedgerCard(children: [LedgerRow(title: '晚餐', amount: '1,250')]),
      ),
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
    await tester.pumpWidget(
      wrap(const LedgerDivider(indent: LedgerRow.iconIndent)),
    );

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
