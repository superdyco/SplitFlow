import 'package:test/test.dart';
import 'package:splitflow/domain/debug_log.dart';
import 'package:splitflow/domain/diagnostics.dart';

/// `tests/debugLog.test.ts` 與 `tests/diagnostics.test.ts` 的 Dart 版。
void main() {
  setUp(clearErrors);

  group('describeError', () {
    test('字串原樣留著', () {
      expect(describeError('permission-denied 沒有權限'), 'permission-denied 沒有權限');
    });

    test('例外印得出內容', () {
      expect(
        describeError(StateError('沒有登入')),
        contains('沒有登入'),
      );
    });

    test('沒有 toString 的物件至少留下型別名稱，不能只有 Instance of', () {
      // Dart 版的 `[object Object]`：印出來只有 `Instance of 'Opaque'`，
      // 那跟沒印一樣。
      expect(describeError(Opaque()), 'Opaque');
    });

    test('null 也不會炸', () {
      expect(describeError(null), '(null)');
    });
  });

  group('logError', () {
    test('連續同樣的錯誤併成一筆，不佔滿清單', () {
      logError('storage', '傳不上去');
      logError('storage', '傳不上去');
      logError('storage', '傳不上去');

      final errors = recentErrors();
      expect(errors, hasLength(1));
      expect(errors.single.count, 3);
    });

    test('中間夾了別的錯誤就分開記 —— 那是兩件事', () {
      logError('storage', '傳不上去');
      logError('firestore', 'permission-denied');
      logError('storage', '傳不上去');

      expect(recentErrors(), hasLength(3));
    });

    test('同一段訊息從不同來源進來不算重複', () {
      logError('storage', '壞了');
      logError('firestore', '壞了');

      expect(recentErrors(), hasLength(2));
    });

    test('超過上限時丟掉最舊的，留下最近的 50 筆', () {
      for (var i = 0; i < maxLoggedErrors + 10; i += 1) {
        logError('firestore', '錯誤 $i');
      }

      final errors = recentErrors();
      expect(errors, hasLength(maxLoggedErrors));
      expect(errors.first.message, '錯誤 10');
      expect(errors.last.message, '錯誤 59');
    });

    test('回傳的是複本，外面改不到清單裡的東西', () {
      logError('firestore', '壞了');
      expect(() => recentErrors().clear(), throwsUnsupportedError);
      expect(recentErrors(), hasLength(1));
    });
  });

  group('buildDiagnosticsText', () {
    DiagnosticsInput input({
      String version = 'abc1234 2026-09-01 10:00',
      String uid = 'u1',
      bool? pushToken = true,
      bool placesKey = true,
      bool mapsKey = true,
      List<LoggedError> errors = const [],
    }) {
      return DiagnosticsInput(
        version: version,
        uid: uid,
        loginMethod: 'Google',
        platform: 'android 14',
        pushToken: pushToken,
        placesKey: placesKey,
        mapsKey: mapsKey,
        errors: errors,
      );
    }

    test('版本排在第一行之後 —— 那是回報問題時第一個要問的', () {
      final lines = buildDiagnosticsText(input()).split('\n');
      expect(lines.first, '簡單分帳診斷資訊');
      expect(lines[1], '版本 abc1234 2026-09-01 10:00');
    });

    test('沒有錯誤時直說，不要留一個空的區塊讓人猜', () {
      expect(buildDiagnosticsText(input()), contains('沒有記錄到錯誤'));
    });

    test('金鑰只講有沒有設定，絕不印出金鑰本身', () {
      final text = buildDiagnosticsText(input(placesKey: false));
      expect(text, contains('地點搜尋金鑰 未設定'));
      expect(text, contains('地圖金鑰 已設定'));
    });

    test('沒登入時講「未登入」，不要留一個空欄位', () {
      expect(buildDiagnosticsText(input(uid: '')), contains('使用者 未登入'));
    });

    test('拿不到推播 token 與問不到是兩件事', () {
      expect(
        buildDiagnosticsText(input(pushToken: false)),
        contains('收不到通知'),
      );
      expect(
        buildDiagnosticsText(input(pushToken: null)),
        contains('問不到'),
      );
    });

    test('重複的錯誤標次數，只出現一次的不加尾巴', () {
      final text = buildDiagnosticsText(input(errors: [
        LoggedError(
          at: DateTime(2026, 9, 1, 10, 30, 5),
          source: 'storage',
          message: '傳不上去',
          count: 3,
        ),
        LoggedError(
          at: DateTime(2026, 9, 1, 10, 31),
          source: 'firestore',
          message: 'permission-denied',
          count: 1,
        ),
      ]));

      expect(text, contains('10:30:05 [storage] 傳不上去 ×3'));
      expect(text, contains('10:31:00 [firestore] permission-denied'));
      expect(text, isNot(contains('permission-denied ×')));
    });
  });
}

/// 只有預設 toString 的東西，用來釘住 `describeError` 不會回
/// `Instance of 'Opaque'`。
class Opaque {}
