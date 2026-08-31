import 'package:test/test.dart';
import 'package:splitflow/domain/auth_error.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/place_bias.dart';
import 'package:splitflow/domain/receipt_policy.dart';
import 'package:splitflow/domain/settlement_text.dart';
import 'package:splitflow/domain/validation.dart';

/// `tests/settlementText.test.ts`、`authError.test.ts`、`receiptPolicy.test.ts`、
/// `placeBias.test.ts`、`validation.test.ts` 的 Dart 版。
void main() {
  group('buildSettlementText', () {
    const names = {'a': '阿明', 'b': '小美'};

    test('列出每一筆轉帳，用暱稱不是 uid', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [Transfer(from: 'b', to: 'a', amount: 50000)],
        memberNames: names,
        expenseCount: 3,
        total: 150000,
      ));

      expect(text, contains('曼谷旅行 · 結算'));
      expect(text, contains('小美 → 阿明  TWD 500.00'));
      expect(text, contains('3 筆支出 · 共 TWD 1,500.00'));
      expect(text, isNot(contains('uid')));
    });

    test('沒有轉帳時說已結清，而不是留一片空白', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [],
        memberNames: names,
        expenseCount: 1,
        total: 30000,
      ));
      expect(text, contains('大家都已結清，不需要轉帳。'));
    });

    test('查不到暱稱的人有備用稱呼', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [Transfer(from: 'zz', to: 'a', amount: 10000)],
        memberNames: names,
        expenseCount: 1,
        total: 10000,
      ));
      expect(text, contains('已離開的成員'));
    });

    test('缺匯率的支出要警告 —— 不講就是散播錯的數字', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [],
        memberNames: names,
        expenseCount: 2,
        total: 30000,
        unconvertedCount: 1,
      ));
      expect(text, contains('⚠ 有 1 筆支出還沒有匯率'));
    });

    test('待確認的付款也要警告', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [],
        memberNames: names,
        expenseCount: 2,
        total: 30000,
        pendingCount: 2,
      ));
      expect(text, contains('⚠ 有 2 筆付款等待確認'));
    });

    test('沒有警告時不留多餘的空行', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [],
        memberNames: names,
        expenseCount: 1,
        total: 30000,
      ));
      expect(text.endsWith('\n'), isFalse);
      expect(text, isNot(contains('⚠')));
    });

    test('快照多帶日期與備註', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [],
        memberNames: names,
        expenseCount: 1,
        total: 30000,
        snapshotDate: '2026/06/20',
        note: '回國後結算',
      ));
      expect(text, contains('曼谷旅行 · 結算（2026/06/20）'));
      expect(text, contains('回國後結算'));
    });

    test('備註只有空白時不輸出', () {
      final text = buildSettlementText(const SettlementTextInput(
        taskName: '曼谷旅行',
        currency: 'TWD',
        transfers: [],
        memberNames: names,
        expenseCount: 1,
        total: 30000,
        note: '   ',
      ));
      final lines = text.split('\n');
      // 標題之後直接是分隔線，中間不會插一行空的備註。
      expect(lines[1], startsWith('────'));
    });
  });

  group('登入錯誤', () {
    test('兩種錯誤碼寫法都認得 —— JS SDK 有 auth/ 前綴，FlutterFire 沒有', () {
      expect(isCancelledSignIn('auth/popup-closed-by-user'), isTrue);
      expect(isCancelledSignIn('popup-closed-by-user'), isTrue);
    });

    test('使用者自己取消不算錯誤，不該顯示紅字', () {
      expect(
        describeSignInError('auth/popup-closed-by-user', SignInProvider.google, '備用'),
        isNull,
      );
      expect(describeSignInError('canceled', SignInProvider.google, '備用'), isNull);
    });

    test('認得的錯誤碼講得出所以然，而且點名是哪個供應商', () {
      final message = describeSignInError(
        'auth/operation-not-allowed',
        SignInProvider.google,
        '備用',
      );
      expect(message, contains('Google'));
      expect(message, contains('Firebase Console'));
    });

    test('認不得的錯誤碼原樣傳出去，不要憑空發明訊息', () {
      expect(
        describeSignInError('auth/沒看過的碼', SignInProvider.google, '原始訊息'),
        '原始訊息',
      );
    });

    test('查得到註冊方式就點名，查不到給通用訊息', () {
      expect(
        existingAccountMessage('a@b.c', ['google.com']),
        contains('用 Google 註冊'),
      );
      expect(
        existingAccountMessage('a@b.c', []),
        contains('用別的方式註冊過'),
      );
    });

    test('providerLabel 認不得就原樣回傳，不會變成空白', () {
      expect(providerLabel('google.com'), 'Google');
      expect(providerLabel('沒看過的供應商'), '沒看過的供應商');
    });
  });

  group('登入供應商清單', () {
    test('Apple 平台提供 Sign in with Apple', () {
      // App Store 指引 4.8：提供第三方登入就必須同時提供 Apple 登入。
      // 少了這個，iOS 版連審查都過不了。
      expect(
        enabledProvidersFor(isApplePlatform: true),
        contains(SignInProvider.apple),
      );
    });

    test('Apple 排在最前面', () {
      // Apple 的人機介面指引要求 Sign in with Apple 至少跟其他登入方式一樣
      // 顯眼，審查員會實際看畫面。排第一是最沒有爭議的做法。
      expect(
        enabledProvidersFor(isApplePlatform: true).first,
        SignInProvider.apple,
      );
    });

    test('非 Apple 平台不顯示 Apple 按鈕', () {
      // Android 上的 Apple 登入只能走網頁 OAuth，體驗比 Google 差一截，
      // 而且沒有任何規定要求 Android 提供。顯示了只是多一條會出錯的路。
      expect(
        enabledProvidersFor(isApplePlatform: false),
        isNot(contains(SignInProvider.apple)),
      );
    });

    test('Google 在每個平台都還在', () {
      expect(
        enabledProvidersFor(isApplePlatform: true),
        contains(SignInProvider.google),
      );
      expect(
        enabledProvidersFor(isApplePlatform: false),
        contains(SignInProvider.google),
      );
    });
  });

  group('收據政策', () {
    test('壓縮後的上限必須跟 storage.rules 一致', () {
      // 改這個數字就要改 storage.rules，反之亦然。網頁版與原生版共用同一份規則。
      expect(maxUploadBytes, 2 * 1024 * 1024);
    });

    test('不到 1MB 顯示 KB，不然全部會變成沒資訊量的 0.0 MB', () {
      expect(formatBytes(500 * 1024), '500 KB');
      expect(formatBytes(2 * 1024 * 1024), '2.0 MB');
    });

    test('在上限內不擋', () {
      expect(sizeRejection(SizeStage.source, maxSourceBytes), isNull);
      expect(sizeRejection(SizeStage.upload, maxUploadBytes), isNull);
    });

    test('超過上限時訊息要說得出該怎麼辦', () {
      final source = sizeRejection(SizeStage.source, maxSourceBytes + 1);
      expect(source, contains('ProRAW'));

      final upload = sizeRejection(SizeStage.upload, maxUploadBytes + 1);
      expect(upload, contains('背景單純'));
    });

    test('收據路徑是推導出來的，換照片就是覆蓋', () {
      expect(receiptPath('t1', 'e1'), 'tasks/t1/expenses/e1/receipt.jpg');
    });

    group('queueAction', () {
      final now = DateTime(2026, 6, 20);

      test('正常的就傳', () {
        expect(
          queueAction(createdAt: now.subtract(const Duration(hours: 1)), attempts: 0, now: now),
          QueueAction.upload,
        );
      });

      test('試太多次就停下來等使用者', () {
        expect(
          queueAction(createdAt: now, attempts: maxAttempts, now: now),
          QueueAction.holdExhausted,
        );
      });

      test('過期優先於試到上限 —— 都過期了留著手動重試也沒意義', () {
        expect(
          queueAction(
            createdAt: now.subtract(const Duration(days: 31)),
            attempts: maxAttempts,
            now: now,
          ),
          QueueAction.dropExpired,
        );
      });
    });
  });

  group('placeBias', () {
    test('挑第一個有座標的地點', () {
      final bias = biasFromPlaces([
        const ExpensePlace(name: '只有名字'),
        const ExpensePlace(name: '有座標', lat: 13.75, lng: 100.5),
      ]);
      expect(bias, const LatLng(13.75, 100.5));
    });

    test('座標是 0 也有效 —— 赤道與本初子午線不是「沒有值」', () {
      final bias = biasFromPlaces([const ExpensePlace(name: '零點', lat: 0, lng: 0)]);
      expect(bias, const LatLng(0, 0));
    });

    test('都沒有座標就回 null', () {
      expect(biasFromPlaces([const ExpensePlace(name: '只有名字'), null]), isNull);
    });

    test('沒有中心點時不產生欄位，退回全球搜尋', () {
      expect(locationBias(null), isNull);
    });

    test('有中心點時包成 Places API 要的形狀', () {
      final bias = locationBias(const LatLng(13.75, 100.5));
      expect(bias?['circle']['center']['latitude'], 13.75);
      expect(bias?['circle']['radius'], biasRadiusMeters);
    });
  });

  group('驗證', () {
    test('required 去掉頭尾空白', () {
      expect(required('  曼谷旅行  ', '任務名稱'), '曼谷旅行');
      expect(() => required('   ', '任務名稱'), throwsFormatException);
    });

    test('還沒碰過的欄位不嘮叨', () {
      expect(textFieldError('', '暱稱', touched: false), isNull);
      expect(textFieldError('', '暱稱'), '暱稱為必填');
    });

    test('超過長度要講出上限', () {
      expect(textFieldError('十個字十個字十個字十個字', '暱稱', max: 5), '暱稱最多 5 個字');
      expect(textFieldError('短的', '暱稱', max: 5), isNull);
    });

    test('結束日期不能早於開始日期', () {
      expect(dateRangeError('2026-06-15', '2026-06-14'), '結束日期不能早於開始日期');
      expect(dateRangeError('2026-06-15', '2026-06-15'), isNull);
      expect(dateRangeError('2026-06-15', '2026-06-20'), isNull);
    });

    test('只填一邊時不檢查', () {
      expect(dateRangeError('', '2026-06-14'), isNull);
      expect(dateRangeError('2026-06-15', ''), isNull);
    });
  });
}
