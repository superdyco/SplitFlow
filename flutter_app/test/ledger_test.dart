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

  testWidgets('位數不同的金額，左緣還是同一條線 —— 這就是「對齊成一欄」', (tester) async {
    /*
      變數必須是**金額的位數**，不是標題長度。標題包在 Expanded 裡，
      它多長都不會推到金額 —— 拿標題當變數的話，這條測試無論金額欄有沒有
      固定寬度都會綠，也就是什麼都沒測到。

      三位數對五位數才分得出來：沒有固定寬度時 '640' 比 '1,250' 窄，
      它的左緣就會往右跑。
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

    final wide = tester.getTopLeft(find.text('1,250'));
    final narrow = tester.getTopLeft(find.text('640'));

    expect(narrow.dx, closeTo(wide.dx, 0.01));
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
