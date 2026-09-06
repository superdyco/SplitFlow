import 'package:flutter_test/flutter_test.dart';
import 'package:splitflow/domain/presence.dart';

void main() {
  group('dayKey', () {
    test('補零到兩位', () {
      expect(dayKey(DateTime(2026, 9, 6)), '2026-09-06');
      expect(dayKey(DateTime(2026, 12, 31)), '2026-12-31');
    });

    test('同一天的不同時刻是同一個鍵', () {
      expect(dayKey(DateTime(2026, 9, 6, 0, 0)), dayKey(DateTime(2026, 9, 6, 23, 59)));
    });

    test('跨日就是不同的鍵', () {
      expect(dayKey(DateTime(2026, 9, 6, 23, 59)), isNot(dayKey(DateTime(2026, 9, 7, 0, 0))));
    });
  });

  group('shouldStamp', () {
    test('今天還沒蓋過就要蓋', () {
      expect(shouldStamp('2026-09-05', '2026-09-06'), isTrue);
    });

    test('今天蓋過了就不用再蓋', () {
      expect(shouldStamp('2026-09-06', '2026-09-06'), isFalse);
    });

    // 第一次開，或偏好設定讀不到。兩種都當成沒蓋過 —— 多寫一次的成本是一次
    // 寫入，少寫一次的成本是這個人今天不存在。
    test('讀不到上次的紀錄就當成沒蓋過', () {
      expect(shouldStamp(null, '2026-09-06'), isTrue);
    });
  });
}
