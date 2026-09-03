import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:splitflow/domain/place_totals.dart';
import 'package:splitflow/ui/report_page.dart';
import 'package:splitflow/ui/theme.dart';

/// 「還有 N 個地點」以前只是一行字，沒有出口 —— 看的人知道有東西被藏起來，
/// 卻永遠看不到是哪幾個。這裡釘的就是「按下去會展開、再按會收回來」。
///
/// 截斷規則本身在 `place_totals_test.dart`，這裡只管那顆按鈕。
void main() {
  PlaceTotal place(int index) {
    return PlaceTotal(
      name: '地點$index',
      placeId: 'p$index',
      lat: 1,
      lng: 2,
      // 金額遞減，順序才看得出來（呼叫端本來就是排好序傳進來的）。
      total: 1000 - index,
      expenseCount: 1,
    );
  }

  /// 預設的測試畫布只有 600 高，11 個地點展開之後「收合」會掉到畫布外面，
  /// 點不到。這裡把畫布拉高，測的才是按鈕本身而不是捲動。
  void tallSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
  }

  Widget wrap(List<PlaceTotal> places) {
    return MaterialApp(
      theme: buildAppTheme(),
      home: Scaffold(
        body: SingleChildScrollView(
          child: PlacesSection(places: places, currency: 'TWD'),
        ),
      ),
    );
  }

  testWidgets('超過上限時先收起來，按下去展得開', (tester) async {
    final places = [for (var i = 0; i < 11; i++) place(i)];

    tallSurface(tester);
    await tester.pumpWidget(wrap(places));

    expect(find.text('地點7'), findsOneWidget);
    expect(find.text('地點8'), findsNothing);
    expect(find.text('還有 3 個地點'), findsOneWidget);

    await tester.tap(find.text('還有 3 個地點'));
    await tester.pumpAndSettle();

    expect(find.text('地點10'), findsOneWidget);
    expect(find.text('收合'), findsOneWidget);

    // 收得回去才算展得開 —— 只能單向展開的話捲動距離就再也回不來了。
    await tester.tap(find.text('收合'));
    await tester.pumpAndSettle();

    expect(find.text('地點8'), findsNothing);
    expect(find.text('還有 3 個地點'), findsOneWidget);
  });

  testWidgets('沒超過上限就不出現那顆按鈕', (tester) async {
    await tester.pumpWidget(wrap([for (var i = 0; i < placeLimit; i++) place(i)]));

    expect(find.textContaining('個地點'), findsNothing);
    expect(find.text('收合'), findsNothing);
  });
}
