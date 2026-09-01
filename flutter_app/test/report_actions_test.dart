import 'package:test/test.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/report_actions.dart';

void main() {
  Task task({
    String ownerId = 'owner',
    List<String> adminIds = const ['admin'],
    String status = 'active',
    String? startDate,
    String? endDate,
    int memberCount = 4,
  }) {
    return Task(
      id: 't1',
      name: '曼谷之旅',
      ownerId: ownerId,
      adminIds: adminIds,
      memberIds: const ['owner', 'admin', 'u3', 'u4'],
      defaultCurrency: 'TWD',
      startDate: startDate,
      endDate: endDate,
      status: status,
      inviteCode: 'abc',
      memberCount: memberCount,
      expenseCount: 3,
    );
  }

  Expense expense({
    String id = 'e1',
    String title = '晚餐',
    int amount = 1000,
    int? baseAmount = 1000,
    String currency = 'TWD',
    String? date = '2026-03-01',
    ExpensePlace? place,
  }) {
    return Expense(
      id: id,
      title: title,
      amount: amount,
      currency: currency,
      baseAmount: baseAmount,
      paidBy: 'owner',
      splits: {'owner': amount},
      category: ExpenseCategory.food,
      date: date,
      place: place,
    );
  }

  group('canShareReport', () {
    test('只有 owner 能產生與撤銷', () {
      expect(canShareReport(task: task(), uid: 'owner'), isTrue);
    });

    test('admin 也不行 —— 公開別人的消費資料只有 owner 能決定', () {
      expect(canShareReport(task: task(), uid: 'admin'), isFalse);
    });

    test('一般成員不行', () {
      expect(canShareReport(task: task(), uid: 'u3'), isFalse);
    });

    test('沒登入不行 —— 空字串不能因為任務沒有 owner 就矇混過去', () {
      expect(canShareReport(task: task(ownerId: ''), uid: ''), isFalse);
    });

    test('封存的任務照樣能產生 —— 報告本來就是旅程結束後才做的', () {
      expect(
        canShareReport(task: task(status: 'archived'), uid: 'owner'),
        isTrue,
      );
    });
  });

  group('buildReport', () {
    test('產生就是開啟，公開與否維持原狀', () {
      final report = buildReport(
        reportId: 'r1',
        task: task(),
        expenses: [expense()],
        mapPath: null,
        listed: true,
      );

      expect(report.active, isTrue);
      // 重新產生不該偷偷改變公開狀態。
      expect(report.listed, isTrue);
    });

    test('沒有地圖也產得出報告 —— 地圖是加分不是必要', () {
      final report = buildReport(
        reportId: 'r1',
        task: task(),
        expenses: [expense()],
        mapPath: null,
        listed: false,
      );

      expect(report.mapPath, isNull);
      expect(report.total, 1000);
    });

    test('四個彙總用同一套規則：缺匯率的支出四邊都排除', () {
      final report = buildReport(
        reportId: 'r1',
        task: task(memberCount: 2),
        expenses: [
          expense(id: 'e1', amount: 1000, baseAmount: 1000),
          expense(id: 'e2', amount: 5000, baseAmount: null, currency: 'JPY'),
        ],
        mapPath: null,
        listed: false,
      );

      expect(report.total, 1000);
      expect(report.expenseCount, 1);
      expect(report.perPerson, 500);
      // 分類、地點、時間軸的小計加起來都要等於總額。
      expect(
        report.categories.fold<int>(0, (sum, item) => sum + item.total),
        1000,
      );
      expect(
        report.places.fold<int>(0, (sum, item) => sum + item.total),
        1000,
      );
      expect(
        report.timeline.fold<int>(0, (sum, day) => sum + day.total),
        1000,
      );
    });

    test('帶上任務的起迄日期與名稱', () {
      final report = buildReport(
        reportId: 'r1',
        task: task(startDate: '2026-03-01', endDate: '2026-03-05'),
        expenses: [expense()],
        mapPath: 'tasks/t1/reports/r1/map.png',
        listed: false,
      );

      expect(report.taskName, '曼谷之旅');
      expect(report.days, 5);
      expect(report.currency, 'TWD');
      expect(report.mapPath, 'tasks/t1/reports/r1/map.png');
    });

    test('沒有支出時也產得出來，數字是 0 而不是壞掉', () {
      final report = buildReport(
        reportId: 'r1',
        task: task(),
        expenses: const [],
        mapPath: null,
        listed: false,
      );

      expect(report.total, 0);
      expect(report.perPerson, 0);
      expect(report.places, isEmpty);
      expect(report.timeline, isEmpty);
    });
  });
}
