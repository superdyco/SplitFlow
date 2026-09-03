import 'package:test/test.dart';
import 'package:splitflow/data/report_mappers.dart';
import 'package:splitflow/domain/category_totals.dart';
import 'package:splitflow/domain/favorites.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/place_totals.dart';
import 'package:splitflow/domain/report.dart';
import 'package:splitflow/domain/report_timeline.dart';

/// 報告與收藏的 mapper。
///
/// 這裡的斷言有兩種性質，都值得釘住：
///
///   - **寫出去的欄位清單**。那份文件任何人拿到連結都讀得到，多一個欄位
///     就是外洩，所以要逐一比對而不是抽查。
///   - **舊文件缺欄位**。這個功能上線後又加過 timeline 與 listed，
///     缺欄位的報告不能讀不出來，更不能被猜成「已公開」。
void main() {
  TripReport report({
    List<ReportDay> timeline = const [],
    bool listed = false,
    String? mapPath = 'tasks/t1/reports/r1/map.png',
  }) {
    return TripReport(
      id: 'r1',
      taskName: '曼谷之旅',
      currency: 'TWD',
      startDate: '2026-03-01',
      endDate: '2026-03-05',
      days: 5,
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
      timeline: timeline,
      mapPath: mapPath,
      active: true,
      listed: listed,
    );
  }

  group('reportToMap', () {
    test('寫出去的欄位就是這些，一個都不能多', () {
      // 多一個欄位就是把它公開出去。這條測試會擋下「順手加一個 createdBy」。
      expect(
        reportToMap(report()).keys.toList()..sort(),
        [
          'active',
          'categories',
          'currency',
          'days',
          'endDate',
          'expenseCount',
          'listed',
          'mapPath',
          'memberCount',
          'perPerson',
          'places',
          'startDate',
          'taskName',
          'timeline',
          'total',
        ],
      );
    });

    test('時間軸只帶得出時間、分類、地點、金額', () {
      final map = reportToMap(report(timeline: const [
        ReportDay(
          date: '2026-03-01',
          day: 1,
          total: 10000,
          entries: [
            ReportEntry(
              time: '12:00',
              category: ExpenseCategory.food,
              name: '午餐',
              amount: 10000,
            ),
          ],
        ),
      ]));

      final day = (map['timeline'] as List).single as Map<String, dynamic>;
      final entry = (day['entries'] as List).single as Map<String, dynamic>;

      /*
        這兩條釘的是「哪些欄位會被寫進任何人拿到連結都讀得到的文件」，
        所以改它要有理由，不是配合實作。

        weather 是後來加的，而它通過那道檢查：地點名稱與日期本來就已經在
        這份文件裡了，「那個地點那天下不下雨」是公開事實，不多洩漏任何東西。

        entry 的 place 換成 name：地點整區列在「去過的地方」了，時間軸再列
        一次是同一份資訊講兩遍。名稱是使用者自己打的字串，會跟著連結公開 ——
        這是刻意的取捨，產生報告的畫面上有講。

        天氣仍然掛在「天」不掛在「筆」：同一天三筆支出印三次一樣的天氣是噪音。
      */
      expect(day.keys.toList()..sort(),
          ['date', 'day', 'entries', 'total', 'weather']);
      expect(entry.keys.toList()..sort(),
          ['amount', 'category', 'name', 'time']);
    });

    test('分類存的是字串 —— 網頁版讀的是同一份文件', () {
      final map = reportToMap(report());
      final category = (map['categories'] as List).single as Map;
      expect(category['category'], 'food');
    });
  });

  group('reportFromMap', () {
    test('寫出去再讀回來是同一份', () {
      final map = reportToMap(report(listed: true));
      final parsed = reportFromMap('r1', map, null);

      expect(parsed.taskName, '曼谷之旅');
      expect(parsed.total, 48000);
      expect(parsed.categories.single.category, ExpenseCategory.food);
      expect(parsed.places.single.name, '大皇宮');
      expect(parsed.places.single.lat, 13.75);
      expect(parsed.active, isTrue);
      expect(parsed.listed, isTrue);
      expect(parsed.mapPath, 'tasks/t1/reports/r1/map.png');
    });

    test('時間軸功能之前的報告沒有那個欄位，補成空清單', () {
      final parsed = reportFromMap('r1', {'taskName': '舊旅程'}, null);
      expect(parsed.timeline, isEmpty);
    });

    test('沒有 listed 的舊報告一律當成沒公開 —— 補值要偏向不外洩', () {
      final parsed = reportFromMap('r1', {'taskName': '舊旅程'}, null);
      expect(parsed.listed, isFalse);
    });

    test('沒有 active 的文件當成關閉，不會意外變成可讀', () {
      final parsed = reportFromMap('r1', {'taskName': '舊旅程'}, null);
      expect(parsed.active, isFalse);
    });

    test('沒有地圖時 mapPath 是 null，空字串也算沒有', () {
      expect(reportFromMap('r1', {'mapPath': ''}, null).mapPath, isNull);
      expect(reportFromMap('r1', const {}, null).mapPath, isNull);
    });
  });

  group('favoriteToMap', () {
    test('收藏只存收藏頁畫得出來的那幾個欄位', () {
      // 規則限制一份收藏最多 16 個欄位；更重要的是報告以後多了什麼
      // （時間軸、地點、分類明細）都不該自動跟著跑進使用者的收藏裡。
      final map = favoriteToMap(toFavorite('t1', 'r1', report()));

      expect(
        map.keys.toList()..sort(),
        [
          'currency',
          'days',
          'endDate',
          'memberCount',
          'reportId',
          'startDate',
          'taskId',
          'taskName',
          'total',
        ],
      );
    });

    test('存進去再讀回來是同一份', () {
      final favorite = toFavorite('t1', 'r1', report());
      final parsed = favoriteFromMap(favorite.id, favoriteToMap(favorite));

      expect(parsed.id, 't1_r1');
      expect(parsed.taskId, 't1');
      expect(parsed.reportId, 'r1');
      expect(parsed.taskName, '曼谷之旅');
      expect(parsed.days, 5);
      expect(parsed.total, 48000);
    });
  });
}
