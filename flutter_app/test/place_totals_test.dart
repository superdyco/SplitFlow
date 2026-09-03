import 'package:test/test.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/place_totals.dart';

/// `tests/placeTotals.test.ts` 與 `tests/reportPlaces.test.ts` 的 Dart 版。
const palace = ExpensePlace(
  name: '大皇宮',
  lat: 13.75,
  lng: 100.49,
  placeId: 'p_palace',
);

void main() {
  Expense expense({
    String id = 'e1',
    int amount = 10000,
    int? baseAmount = 10000,
    String currency = 'TWD',
    ExpensePlace? place = palace,
  }) {
    return Expense(
      id: id,
      title: '門票',
      amount: amount,
      currency: currency,
      baseAmount: baseAmount,
      paidBy: 'u1',
      splits: {'u1': amount},
      place: place,
    );
  }

  group('placeTotals', () {
    test('同一個地點的多筆支出合併成一列', () {
      final rows = placeTotals([
        expense(id: 'e1', amount: 10000, baseAmount: 10000),
        expense(id: 'e2', amount: 5000, baseAmount: 5000),
      ], 'TWD');

      expect(rows, hasLength(1));
      expect(rows.first.total, 15000);
      expect(rows.first.expenseCount, 2);
    });

    test('依金額由大到小排序', () {
      final rows = placeTotals([
        expense(
          id: 'e1',
          amount: 1000,
          baseAmount: 1000,
          place: const ExpensePlace(name: '小吃店', placeId: 'p_a'),
        ),
        expense(id: 'e2', amount: 9000, baseAmount: 9000),
      ], 'TWD');

      expect(rows.map((row) => row.name), ['大皇宮', '小吃店']);
    });

    test('沒有地點的支出歸到「未指定地點」', () {
      final rows = placeTotals([expense(place: null)], 'TWD');
      expect(rows.single.name, noPlaceLabel);
      expect(rows.single.placeId, isNull);
    });

    test('「未指定地點」永遠排在最後，就算金額最大', () {
      final rows = placeTotals([
        expense(id: 'e1', amount: 99000, baseAmount: 99000, place: null),
        expense(id: 'e2', amount: 1000, baseAmount: 1000),
      ], 'TWD');

      expect(rows.last.name, noPlaceLabel);
    });

    test('只打名字沒選建議的地點也算一個地點，但沒有座標', () {
      final rows = placeTotals(
        [expense(place: const ExpensePlace(name: '巷口那家'))],
        'TWD',
      );

      expect(rows.single.name, '巷口那家');
      expect(rows.single.lat, isNull);
      expect(rows.single.placeId, isNull);
    });

    test('同名的純文字地點會合併 —— 使用者打一樣的名字就是指同一個地方', () {
      final rows = placeTotals([
        expense(
          id: 'e1',
          amount: 100,
          baseAmount: 100,
          place: const ExpensePlace(name: '巷口那家'),
        ),
        expense(
          id: 'e2',
          amount: 200,
          baseAmount: 200,
          place: const ExpensePlace(name: '巷口那家'),
        ),
      ], 'TWD');

      expect(rows, hasLength(1));
      expect(rows.single.total, 300);
    });

    test('缺匯率換算不出來的支出要排除，否則總額會跟結算對不起來', () {
      final rows = placeTotals([
        expense(id: 'e1', amount: 1000, baseAmount: 1000),
        expense(
          id: 'e2',
          amount: 5000,
          baseAmount: null,
          currency: 'JPY',
        ),
      ], 'TWD');

      expect(rows.single.total, 1000);
      expect(rows.single.expenseCount, 1);
    });

    test('空清單回傳空清單', () {
      expect(placeTotals(const [], 'TWD'), isEmpty);
    });
  });

  group('visiblePlaces', () {
    PlaceTotal row(String name, int total) => PlaceTotal(
          name: name,
          placeId: null,
          lat: null,
          lng: null,
          total: total,
          expenseCount: 1,
        );

    test('最多顯示 8 個，其餘回報成 hiddenCount', () {
      final places = [
        for (var i = 0; i < 12; i += 1) row('地點$i', 1000 - i),
      ];
      final visible = visiblePlaces(places);

      expect(visible.rows, hasLength(8));
      expect(visible.hiddenCount, 4);
    });

    test('沒有超過上限時 hiddenCount 是 0', () {
      final visible = visiblePlaces([row('A', 100)]);
      expect(visible.hiddenCount, 0);
    });

    test('金額最大的地點長條滿格', () {
      final visible = visiblePlaces([row('A', 1000), row('B', 500)]);
      expect(visible.rows.first.bar, 1);
      expect(visible.rows.last.bar, 0.5);
    });

    test('未指定地點不畫長條', () {
      final visible = visiblePlaces([row('A', 1000), row(noPlaceLabel, 800)]);
      expect(visible.rows.last.place.name, noPlaceLabel);
      expect(visible.rows.last.bar, isNull);
    });

    test('未指定地點金額最大時，不影響其他地點的長條基準', () {
      final visible = visiblePlaces([
        row('A', 1000),
        row('B', 500),
        row(noPlaceLabel, 99999),
      ]);

      expect(visible.rows.first.bar, 1);
      expect(visible.rows[1].bar, 0.5);
    });

    test('基準只看顯示出來的那幾個', () {
      // 第 9 個以後被收起來，基準是第 1 個而不是被藏起來的那個。
      final places = [
        for (var i = 0; i < 10; i += 1) row('地點$i', 100),
      ];
      final visible = visiblePlaces(places);
      expect(visible.rows.first.bar, 1);
    });

    test('全部都是未指定地點時不會除以零', () {
      final visible = visiblePlaces([row(noPlaceLabel, 500)]);
      expect(visible.rows.single.bar, isNull);
    });

    test('空清單不會爆', () {
      final visible = visiblePlaces(const []);
      expect(visible.rows, isEmpty);
      expect(visible.hiddenCount, 0);
    });
  });

  group('mappablePlaces', () {
    test('只留有座標的 —— 純文字地點畫不到地圖上', () {
      final places = [
        const PlaceTotal(
          name: '有座標',
          placeId: null,
          lat: 1,
          lng: 2,
          total: 100,
          expenseCount: 1,
        ),
        const PlaceTotal(
          name: '沒座標',
          placeId: null,
          lat: null,
          lng: null,
          total: 100,
          expenseCount: 1,
        ),
      ];

      expect(mappablePlaces(places).map((p) => p.name), ['有座標']);
    });

    // 二十幾個地點的旅程很正常，那些不該從地圖上消失。
    test('一般規模的旅程一個標記都不截', () {
      final places = [
        for (var i = 0; i < 60; i++)
          PlaceTotal(
            name: '地點$i',
            placeId: null,
            lat: 1,
            lng: 2,
            total: 100,
            expenseCount: 1,
          ),
      ];

      expect(mappablePlaces(places), hasLength(60));
    });

    // 上限的意義就是「網址塞得下」，所以直接量網址。
    test('塞到上限時網址仍在 Static Maps 的 16384 字元限制內', () {
      final markers = [
        for (var i = 0; i < maxMarkers; i++) '-123.456789,-123.456789',
      ].join('|');

      expect('markers=color:0xe8590c|$markers'.length, lessThan(16384 - 1384));
    });
  });
}
