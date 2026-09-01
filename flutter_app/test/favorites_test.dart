import 'package:test/test.dart';
import 'package:splitflow/domain/category_totals.dart';
import 'package:splitflow/domain/favorites.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/place_totals.dart';
import 'package:splitflow/domain/report.dart';
import 'package:splitflow/domain/report_timeline.dart';

/// `tests/favorites.test.ts` 的 Dart 版。
void main() {
  TripReport report({
    String taskName = '曼谷之旅',
    String? startDate = '2026-03-01',
    String? endDate = '2026-03-05',
    int? days = 5,
  }) {
    return TripReport(
      id: 'r1',
      taskName: taskName,
      currency: 'TWD',
      startDate: startDate,
      endDate: endDate,
      days: days,
      memberCount: 4,
      expenseCount: 12,
      total: 48000,
      perPerson: 12000,
      categories: const [
        CategoryTotal(
          category: ExpenseCategory.food,
          total: 20000,
          share: 41.6,
        ),
      ],
      places: const [
        PlaceTotal(
          name: '大皇宮',
          placeId: 'p_palace',
          lat: 13.75,
          lng: 100.49,
          total: 10000,
          expenseCount: 2,
        ),
      ],
      timeline: const [
        ReportDay(
          date: '2026-03-01',
          day: 1,
          total: 10000,
          entries: [
            ReportEntry(
              time: '12:00',
              category: ExpenseCategory.food,
              place: '大皇宮',
              amount: 10000,
            ),
          ],
        ),
      ],
      mapPath: 'tasks/t1/reports/r1/map.png',
      active: true,
      listed: true,
    );
  }

  group('favoriteId', () {
    test('同一份報告永遠算出同一個 id —— 按兩次收藏不會變成兩筆', () {
      expect(favoriteId('t1', 'r1'), favoriteId('t1', 'r1'));
    });

    test('不同的報告不會撞在一起', () {
      expect(favoriteId('t1', 'r1'), isNot(favoriteId('t1', 'r2')));
      expect(favoriteId('t1', 'r1'), isNot(favoriteId('t2', 'r1')));
    });

    test('兩段是分開的，不會因為切在別的位置就湊出同一個 id', () {
      expect(favoriteId('ab', 'c'), isNot(favoriteId('a', 'bc')));
    });
  });

  group('toFavorite', () {
    test('收藏頁畫得出來的欄位都要在', () {
      final favorite = toFavorite('t1', 'r1', report());

      expect(favorite.id, 't1_r1');
      expect(favorite.taskId, 't1');
      expect(favorite.reportId, 'r1');
      expect(favorite.taskName, '曼谷之旅');
      expect(favorite.currency, 'TWD');
      expect(favorite.startDate, '2026-03-01');
      expect(favorite.endDate, '2026-03-05');
      expect(favorite.days, 5);
      expect(favorite.memberCount, 4);
      expect(favorite.total, 48000);
    });

    test('沒填日期的旅程照樣收藏得起來', () {
      final favorite = toFavorite(
        't1',
        'r1',
        report(startDate: null, endDate: null, days: null),
      );

      expect(favorite.startDate, isNull);
      expect(favorite.endDate, isNull);
      expect(favorite.days, isNull);
    });
  });
}
