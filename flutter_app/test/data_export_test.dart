import 'package:splitflow/domain/data_export.dart';
import 'package:test/test.dart';

class _FakeTimestamp {
  final DateTime value;

  const _FakeTimestamp(this.value);

  DateTime toDate() => value;
}

void main() {
  test('匯出值把 Timestamp 與巢狀資料轉成 JSON 可用格式', () {
    final value = exportJsonValue({
      'at': _FakeTimestamp(DateTime.utc(2026, 8, 30, 12, 34, 56)),
      'items': [
        {'amount': 35000, 'ok': true},
      ],
    });

    expect(value, {
      'at': '2026-08-30T12:34:56.000Z',
      'items': [
        {'amount': 35000, 'ok': true},
      ],
    });
  });
}
