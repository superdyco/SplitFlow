import 'package:test/test.dart';
import 'package:splitflow/domain/expense_markers.dart';
import 'package:splitflow/domain/models.dart';

void main() {
  Expense expense({
    required String id,
    String title = '晚餐',
    ExpensePlace? place,
  }) {
    return Expense(
      id: id,
      title: title,
      amount: 1000,
      currency: 'TWD',
      baseAmount: 1000,
      paidBy: 'a',
      splits: const {'a': 1000},
      place: place,
    );
  }

  group('expenseMarkers', () {
    test('沒填地點的支出不畫在地圖上', () {
      final markers = expenseMarkers([expense(id: 'e1')]);
      expect(markers, isEmpty);
    });

    test('只有名字、沒有座標的地點不畫在地圖上', () {
      // 使用者自己打字的地點就是這樣：有 name，其餘是 null。
      final markers = expenseMarkers([
        expense(id: 'e1', place: const ExpensePlace(name: '巷口那家')),
      ]);
      expect(markers, isEmpty);
    });

    test('有座標的畫得上，標題同時帶支出名稱與地點名稱', () {
      final markers = expenseMarkers([
        expense(
          id: 'e1',
          title: '拉麵',
          place: const ExpensePlace(name: '一蘭', lat: 35.66, lng: 139.7),
        ),
      ]);

      expect(markers, hasLength(1));
      expect(markers.first.id, 'e1');
      expect(markers.first.lat, 35.66);
      expect(markers.first.lng, 139.7);
      expect(markers.first.title, '拉麵 · 一蘭');
    });

    test('順序照傳進來的，不重排', () {
      final markers = expenseMarkers([
        expense(
          id: 'e2',
          place: const ExpensePlace(name: 'B', lat: 1, lng: 1),
        ),
        expense(id: 'e3'),
        expense(
          id: 'e1',
          place: const ExpensePlace(name: 'A', lat: 2, lng: 2),
        ),
      ]);

      expect(markers.map((m) => m.id), ['e2', 'e1']);
    });
  });

  group('markerBounds', () {
    test('沒有標記就沒有範圍', () {
      expect(markerBounds(const []), isNull);
    });

    test('單一標記的範圍是那個點本身', () {
      final bounds = markerBounds(const [
        MapMarker(id: 'e1', lat: 25.03, lng: 121.56, title: 'x'),
      ])!;

      expect(bounds.south, 25.03);
      expect(bounds.north, 25.03);
      expect(bounds.centerLat, 25.03);
      expect(bounds.centerLng, 121.56);
    });

    test('框住全部標記，南西北東各取極值', () {
      final bounds = markerBounds(const [
        MapMarker(id: 'e1', lat: 25.0, lng: 121.0, title: 'x'),
        MapMarker(id: 'e2', lat: 35.0, lng: 139.0, title: 'y'),
        MapMarker(id: 'e3', lat: 30.0, lng: 100.0, title: 'z'),
      ])!;

      expect(bounds.south, 25.0);
      expect(bounds.north, 35.0);
      expect(bounds.west, 100.0);
      expect(bounds.east, 139.0);
      expect(bounds.centerLat, 30.0);
      expect(bounds.centerLng, 119.5);
    });

    test('南半球與西半球的負座標也框得住', () {
      final bounds = markerBounds(const [
        MapMarker(id: 'e1', lat: -33.86, lng: 151.2, title: 'x'),
        MapMarker(id: 'e2', lat: -41.28, lng: 174.77, title: 'y'),
      ])!;

      expect(bounds.south, -41.28);
      expect(bounds.north, -33.86);
      expect(bounds.west, 151.2);
      expect(bounds.east, 174.77);
    });
  });
}
