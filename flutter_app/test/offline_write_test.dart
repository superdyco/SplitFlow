import 'dart:async';

import 'package:test/test.dart';
import 'package:splitflow/domain/offline_write.dart';

/// `tests/offlineWrite.test.ts` 的 Dart 版。
///
/// 這支釘住的是一個很容易寫壞的取捨：離線時 Firestore 的寫入 Future 永遠不會
/// 完成，所以要等一小段時間就放使用者往下走 —— 但**不能因此把真正的錯誤吞掉**。
void main() {
  const fast = Duration(milliseconds: 50);

  test('伺服器有回應就是 synced', () async {
    final outcome = await settleWrite(Future<void>.value(), timeout: fast);
    expect(outcome, WriteOutcome.synced);
  });

  test('逾時就當作已排隊，讓使用者往下走', () async {
    // 永遠不會完成的 Future，模擬離線時的寫入。
    final outcome = await settleWrite(Completer<void>().future, timeout: fast);
    expect(outcome, WriteOutcome.queued);
  });

  test('逾時之前失敗的話，錯誤要傳出去 —— 不能默默當成成功', () async {
    final failed = Future<void>.error(StateError('permission-denied'));
    await expectLater(
      settleWrite(failed, timeout: fast),
      throwsA(isA<StateError>()),
    );
  });

  test('逾時之後才失敗的，不會炸成未處理的例外', () async {
    final completer = Completer<void>();
    final outcome = await settleWrite(completer.future, timeout: fast);
    expect(outcome, WriteOutcome.queued);

    // 逾時後才拒絕。已經回報 queued 了，這裡只要確認它有被接住、
    // 不會變成 unhandled error 把整個測試跑掛。
    completer.completeError(StateError('太晚了'));
    await Future<void>.delayed(const Duration(milliseconds: 20));
  });

  test('比逾時早一點完成的照樣算 synced —— 邊界不能反過來', () async {
    final completer = Completer<void>();
    final result = settleWrite(completer.future, timeout: const Duration(milliseconds: 200));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    completer.complete();
    expect(await result, WriteOutcome.synced);
  });
}
