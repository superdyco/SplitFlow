import 'package:test/test.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/trip_summary.dart';

/// `tests/tripSummary.test.ts` 的 Dart 版。
void main() {
  Expense expense({
    String id = 'e1',
    int amount = 1000,
    int? baseAmount = 1000,
    String currency = 'TWD',
    String? date,
  }) {
    return Expense(
      id: id,
      title: '支出',
      amount: amount,
      currency: currency,
      baseAmount: baseAmount,
      paidBy: 'a',
      splits: {'a': amount},
      date: date,
    );
  }

  TripSummary summarize(
    List<Expense> expenses, {
    int memberCount = 2,
    String? startDate,
    String? endDate,
  }) {
    return tripSummary(
      expenses: expenses,
      baseCurrency: 'TWD',
      memberCount: memberCount,
      startDate: startDate,
      endDate: endDate,
    );
  }

  group('天數', () {
    test('優先用任務的起迄日期，而且含頭尾', () {
      final summary = summarize(
        [expense(date: '2026-03-02')],
        startDate: '2026-03-01',
        endDate: '2026-03-05',
      );
      expect(summary.days, 5);
    });

    test('同一天出發與結束算一天，不是零天', () {
      final summary = summarize(
        [expense(date: '2026-03-01')],
        startDate: '2026-03-01',
        endDate: '2026-03-01',
      );
      expect(summary.days, 1);
    });

    test('沒設起迄日期就用支出日期的頭尾', () {
      final summary = summarize([
        expense(id: 'e1', date: '2026-03-05'),
        expense(id: 'e2', date: '2026-03-01'),
      ]);
      expect(summary.days, 5);
    });

    test('沒有起迄也沒有支出時是 null，不要顯示假的數字', () {
      expect(summarize(const []).days, isNull);
    });

    test('跨月與跨年也算得對 —— 日期數學走 UTC，不受時區影響', () {
      expect(
        summarize(const [], startDate: '2025-12-30', endDate: '2026-01-02').days,
        4,
      );
    });
  });

  group('每人平均', () {
    test('是總額除以人數', () {
      final summary = summarize([expense(amount: 900, baseAmount: 900)],
          memberCount: 3);
      expect(summary.perPerson, 300);
    });

    test('除不盡就四捨五入到最小單位 —— 這是參考值，不需要分毫不差', () {
      final summary = summarize([expense(amount: 1000, baseAmount: 1000)],
          memberCount: 3);
      expect(summary.perPerson, 333);
    });

    test('人數是 0 時不會除以零，回傳 0', () {
      final summary = summarize([expense()], memberCount: 0);
      expect(summary.perPerson, 0);
      expect(summary.total, 1000);
    });
  });

  test('缺匯率的支出不算進總額與筆數，跟地點與分類保持一致', () {
    final summary = summarize([
      expense(id: 'e1', amount: 1000, baseAmount: 1000),
      // 外幣又沒有 baseAmount：換算不出來，四個彙總都要排除它。
      expense(id: 'e2', amount: 5000, baseAmount: null, currency: 'JPY'),
    ]);

    expect(summary.total, 1000);
    expect(summary.expenseCount, 1);
  });

  group('daysBetween', () {
    test('含頭尾', () {
      expect(daysBetween('2026-03-01', '2026-03-03'), 3);
    });

    test('格式不對就回 null，不要猜', () {
      expect(daysBetween('2026/03/01', '2026-03-03'), isNull);
      expect(daysBetween('', '2026-03-03'), isNull);
    });
  });
}
