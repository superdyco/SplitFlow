import 'package:test/test.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/report_timeline.dart';

/// `tests/reportTimeline.test.ts` 的 Dart 版。
void main() {
  Expense expense({
    String id = 'e1',
    String title = '晚餐',
    int amount = 1000,
    int? baseAmount = 1000,
    String currency = 'TWD',
    String? date = '2026-03-01',
    String? time,
    ExpenseCategory category = ExpenseCategory.food,
    ExpensePlace? place,
    DateTime? createdAt,
  }) {
    return Expense(
      id: id,
      title: title,
      amount: amount,
      currency: currency,
      baseAmount: baseAmount,
      paidBy: 'u1',
      splits: {'u1': amount},
      category: category,
      date: date,
      time: time,
      place: place,
      createdAt: createdAt,
    );
  }

  test('一天一段，日期由早到晚', () {
    final days = reportTimeline([
      expense(id: 'e1', date: '2026-03-03'),
      expense(id: 'e2', date: '2026-03-01'),
    ], 'TWD');

    expect(days.map((day) => day.date), ['2026-03-01', '2026-03-03']);
  });

  test('同一天照時間由早到晚排', () {
    final entries = reportTimeline([
      expense(id: 'e1', time: '19:00'),
      expense(id: 'e2', time: '08:30'),
      expense(id: 'e3', time: '12:00'),
    ], 'TWD').single.entries;

    expect(entries.map((entry) => entry.time), ['08:30', '12:00', '19:00']);
  });

  test('沒記時間的排在當天最後，不會被猜到中間去', () {
    final entries = reportTimeline([
      expense(id: 'e1', time: '19:00'),
      expense(id: 'e2'),
      expense(id: 'e3', time: '08:30'),
    ], 'TWD').single.entries;

    expect(entries.map((entry) => entry.time), ['08:30', '19:00', '']);
  });

  test('都沒記時間時照記帳先後排，先記的在前', () {
    final entries = reportTimeline([
      // createdAt 還沒回來 = 剛送出的那一筆。
      expense(id: 'e1', amount: 100, baseAmount: 100),
      expense(
        id: 'e2',
        amount: 200,
        baseAmount: 200,
        createdAt: DateTime.utc(2026, 3, 1, 10),
      ),
      expense(
        id: 'e3',
        amount: 300,
        baseAmount: 300,
        createdAt: DateTime.utc(2026, 3, 1, 9),
      ),
    ], 'TWD').single.entries;

    // 先記的（9 點）在前，後記的（10 點）在後。createdAt 還沒回來的那筆是
    // 「剛送出」，排在最後。
    expect(entries.map((entry) => entry.amount), [300, 200, 100]);
  });

  test('每天有小計，加起來就是那天的花費', () {
    final day = reportTimeline([
      expense(id: 'e1', amount: 1000, baseAmount: 1000),
      expense(id: 'e2', amount: 500, baseAmount: 500),
    ], 'TWD').single;

    expect(day.total, 1500);
  });

  test('缺匯率換算不出來的支出不進時間軸 —— 進去的話每日小計會跟總額對不起來', () {
    final day = reportTimeline([
      expense(id: 'e1', amount: 1000, baseAmount: 1000),
      expense(id: 'e2', amount: 5000, baseAmount: null, currency: 'JPY'),
    ], 'TWD').single;

    expect(day.entries, hasLength(1));
    expect(day.total, 1000);
  });

  test('連日期都沒有的支出放不上時間軸', () {
    final days = reportTimeline([expense(date: null)], 'TWD');
    expect(days, isEmpty);
  });

  test('Day 從任務起始日算起，含頭尾', () {
    final days = reportTimeline([
      expense(id: 'e1', date: '2026-03-01'),
      expense(id: 'e2', date: '2026-03-10'),
    ], 'TWD', '2026-03-01');

    expect(days.map((day) => day.day), [1, 10]);
  });

  test('沒有起始日就用最早的那天當 Day 1', () {
    final days = reportTimeline([
      expense(id: 'e1', date: '2026-03-05'),
      expense(id: 'e2', date: '2026-03-06'),
    ], 'TWD');

    expect(days.map((day) => day.day), [1, 2]);
  });

  test('支出早於起始日時改用那天當原點，不會出現 Day 0 或負數', () {
    // 提前買的機票：記在起始日之前。
    final days = reportTimeline([
      expense(id: 'e1', date: '2026-02-01'),
      expense(id: 'e2', date: '2026-03-01'),
    ], 'TWD', '2026-03-01');

    expect(days.first.day, 1);
    expect(days.every((day) => day.day >= 1), isTrue);
  });

  test('只放公開得起的欄位 —— 沒有名稱、沒有地址、沒有人', () {
    // 這份資料會寫進任何人拿到連結都讀得到的文件裡，欄位跑進來就是外洩。
    // Dart 沒有 Object.keys，改成逐一斷言 ReportEntry 只帶得動這四個值。
    final entry = reportTimeline([
      expense(
        title: '阿明的點心',
        time: '15:00',
        place: const ExpensePlace(
          name: '一蘭',
          address: '福岡市博多區',
          lat: 33.59,
          lng: 130.4,
          placeId: 'p_ichiran',
        ),
      ),
    ], 'TWD').single.entries.single;

    expect(entry.time, '15:00');
    expect(entry.category, ExpenseCategory.food);
    expect(entry.amount, 1000);
    // 地點只留名字，座標與地址都不跟著出去。
    expect(entry.place, '一蘭');
  });
}
