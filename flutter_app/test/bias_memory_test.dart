import 'dart:convert';

import 'package:splitflow/domain/bias_memory.dart';
import 'package:splitflow/domain/models.dart';
import 'package:test/test.dart';

void main() {
  ExpensePlace at(double lat, double lng) =>
      ExpensePlace(name: '某處', lat: lat, lng: lng);

  group('recallBias', () {
    test('讀得回存進去的座標', () {
      final stored = rememberBias(null, 'task1', at(25.03, 121.56));
      final bias = recallBias(stored, 'task1');
      expect(bias?.lat, 25.03);
      expect(bias?.lng, 121.56);
    });

    test('不同任務互不影響 —— 不同旅程在不同城市', () {
      var stored = rememberBias(null, 'kyoto', at(35.01, 135.76));
      stored = rememberBias(stored, 'hanoi', at(21.02, 105.83));

      expect(recallBias(stored, 'kyoto')?.lat, 35.01);
      expect(recallBias(stored, 'hanoi')?.lat, 21.02);
    });

    test('沒存過、空字串、壞掉的內容都只是沒有偏好', () {
      expect(recallBias(null, 'task1'), isNull);
      expect(recallBias('', 'task1'), isNull);
      expect(recallBias('{ 這不是 JSON', 'task1'), isNull);
      expect(recallBias('[1,2,3]', 'task1'), isNull);
    });

    test('存進去的座標形狀不對也是沒有偏好', () {
      expect(recallBias('{"task1":{"lat":"25"}}', 'task1'), isNull);
      expect(recallBias('{"task1":null}', 'task1'), isNull);
      expect(recallBias('{"task1":{}}', 'task1'), isNull);
    });

    test('赤道與本初子午線上的 0 是有效座標', () {
      final stored = rememberBias(null, 'task1', at(0, 0));
      expect(recallBias(stored, 'task1')?.lat, 0);
    });
  });

  group('rememberBias', () {
    test('沒有座標就回 null，代表不要動已經存好的那份', () {
      final stored = rememberBias(null, 'task1', at(25.03, 121.56));
      final next =
          rememberBias(stored, 'task1', const ExpensePlace(name: '只打了名字'));

      expect(next, isNull);
      // 呼叫端因此不會覆寫，原本的偏好還在。
      expect(recallBias(stored, 'task1')?.lat, 25.03);
    });

    test('同一個任務再記一次是覆蓋，不是長出第二筆', () {
      var stored = rememberBias(null, 'task1', at(25.03, 121.56));
      stored = rememberBias(stored, 'task1', at(35.01, 135.76));

      expect(recallBias(stored, 'task1')?.lat, 35.01);
      expect((jsonDecode(stored!) as Map).length, 1);
    });

    test('超過上限時砍掉最久沒用到的', () {
      String? stored;
      for (var i = 0; i < biasLimit + 5; i++) {
        stored = rememberBias(stored, 'task$i', at(i.toDouble(), 0));
      }

      final map = jsonDecode(stored!) as Map;
      expect(map.length, biasLimit);
      // 最早的那幾個被擠掉了，最後的都還在。
      expect(recallBias(stored, 'task0'), isNull);
      expect(recallBias(stored, 'task4'), isNull);
      expect(recallBias(stored, 'task5'), isNotNull);
      expect(recallBias(stored, 'task${biasLimit + 4}'), isNotNull);
    });

    test('用過的任務會排到最後，不會因為久沒新增就被擠掉', () {
      String? stored;
      for (var i = 0; i < biasLimit; i++) {
        stored = rememberBias(stored, 'task$i', at(i.toDouble(), 0));
      }
      // task0 本來排在最前面，再用一次應該把它救回來。
      stored = rememberBias(stored, 'task0', at(99, 0));
      stored = rememberBias(stored, 'newcomer', at(1, 1));

      expect(recallBias(stored, 'task0')?.lat, 99);
      // 被擠掉的變成第二舊的那個。
      expect(recallBias(stored, 'task1'), isNull);
    });

    test('壞掉的舊內容不會擋住新的記憶', () {
      final stored = rememberBias('{ 壞掉的', 'task1', at(25.03, 121.56));
      expect(recallBias(stored, 'task1')?.lat, 25.03);
    });
  });
}
