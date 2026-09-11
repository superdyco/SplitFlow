import 'package:test/test.dart';
import 'package:splitflow/domain/ai_receipt.dart';

/// `tests/aiReceipt.test.ts` 的 Dart 版，案例一比一照搬。
AiReceiptFields fields({
  String? amount = '1280',
  String? currency = 'JPY',
  bool currencySupported = true,
  String? date = '2026-09-10',
  String? time = '19:05',
  String? title = 'すき家',
  String? category = 'food',
}) =>
    AiReceiptFields(
      amount: amount,
      currency: currency,
      currencySupported: currencySupported,
      date: date,
      time: time,
      title: title,
      category: category,
    );

void main() {
  group('aiButtonState', () {
    test('正常：顯示剩幾點', () {
      final b = aiButtonState(guest: false, online: true, balance: 2, busy: false);
      expect(b.kind, AiButtonKind.ready);
      expect(b.label, '用 AI 讀收據（剩 2 點）');
      expect(b.disabled, false);
    });

    test('還沒用過顯示 3 點', () {
      expect(
        aiButtonState(guest: false, online: true, balance: null, busy: false).label,
        '用 AI 讀收據（剩 3 點）',
      );
    });

    test('訪客按得下去', () {
      final b = aiButtonState(guest: true, online: true, balance: 2, busy: false);
      expect(b.kind, AiButtonKind.guest);
      expect(b.label, '用 AI 讀收據');
      expect(b.disabled, false);
    });

    test('點數用完、沒網路都停用', () {
      final empty = aiButtonState(guest: false, online: true, balance: 0, busy: false);
      expect(empty.label, 'AI 點數用完了');
      expect(empty.disabled, true);
      final offline = aiButtonState(guest: false, online: false, balance: 2, busy: false);
      expect(offline.label, '需要網路');
      expect(offline.disabled, true);
    });

    test('辨識中優先', () {
      final b = aiButtonState(guest: false, online: false, balance: 2, busy: true);
      expect(b.kind, AiButtonKind.busy);
      expect(b.label, '辨識中…');
      expect(b.disabled, true);
    });
  });

  group('aiPatch', () {
    test('讀到的全部蓋掉，照固定順序列出', () {
      final p = aiPatch(fields(), baseCurrency: 'TWD', currentCurrency: 'TWD');
      expect(p.amount, '1280');
      expect(p.currency, 'JPY');
      expect(p.date, '2026-09-10');
      expect(p.time, '19:05');
      expect(p.title, 'すき家');
      expect(p.category, 'food');
      expect(p.filled, ['金額', '幣別', '日期', '時間', '支出名稱', '分類']);
      expect(p.warning, isNull);
    });

    test('沒讀到的不動', () {
      final p = aiPatch(
        fields(time: null, category: null, title: null),
        baseCurrency: 'TWD',
        currentCurrency: 'TWD',
      );
      expect(p.time, isNull);
      expect(p.category, isNull);
      expect(p.filled, ['金額', '幣別', '日期']);
    });

    test('不支援的幣別改用主要幣別並警告', () {
      final p = aiPatch(
        fields(amount: '40000', currency: 'KHR', currencySupported: false),
        baseCurrency: 'TWD',
        currentCurrency: 'TWD',
      );
      expect(p.currency, 'TWD');
      expect(p.amount, '40000.00');
      expect(p.warning, '收據上是 KHR 40000，目前不支援這個幣別，已改用 TWD —— 金額請自己換算後再存');
      expect(p.filled.contains('金額'), true);
      expect(p.filled.contains('幣別'), false);
    });

    test('主要幣別是日圓時 12.5 變 13', () {
      final p = aiPatch(
        fields(amount: '12.5', currency: 'KHR', currencySupported: false),
        baseCurrency: 'JPY',
        currentCurrency: 'JPY',
      );
      expect(p.amount, '13');
    });

    test('沒讀到幣別：依表單現在的幣別整理', () {
      final p = aiPatch(
        fields(amount: '85', currency: null, currencySupported: false),
        baseCurrency: 'TWD',
        currentCurrency: 'TWD',
      );
      expect(p.currency, isNull);
      expect(p.amount, '85.00');
      expect(p.warning, isNull);
    });

    test('不支援又沒讀出金額：警告不提金額', () {
      final p = aiPatch(
        fields(amount: null, currency: 'KHR', currencySupported: false),
        baseCurrency: 'TWD',
        currentCurrency: 'TWD',
      );
      expect(p.warning, '收據上的幣別是 KHR，目前不支援，已改用 TWD');
    });
  });

  group('splitAfterAi', () {
    test('自訂而且變了：切回平分，給有填金額的人', () {
      final r = splitAfterAi(
        custom: true,
        customAmounts: {'a': '300', 'b': ' 0 ', 'c': '', 'd': '12.5'},
        changed: true,
      );
      expect(r?.memberIds, ['a', 'd']);
    });

    test('自訂但沒有人有金額：切回平分，分攤的人不動', () {
      final r = splitAfterAi(custom: true, customAmounts: {'a': ''}, changed: true);
      expect(r, isNotNull);
      expect(r!.memberIds, isNull);
    });

    test('自訂但都沒變：不動', () {
      expect(splitAfterAi(custom: true, customAmounts: {'a': '300'}, changed: false), isNull);
    });

    test('本來就是平分：不動', () {
      expect(splitAfterAi(custom: false, customAmounts: const {}, changed: true), isNull);
    });
  });

  group('aiMessage', () {
    test('讀出', () {
      expect(
        aiMessage(readResult: 'read', filled: ['金額', '幣別'], creditsLeft: 2, splitReset: false),
        'AI 已填入：金額、幣別（剩 2 點）',
      );
    });

    test('讀出而且分帳改回平分', () {
      expect(
        aiMessage(readResult: 'read', filled: ['金額'], creditsLeft: 0, splitReset: true),
        'AI 已填入：金額（剩 0 點）。分帳已改回平分',
      );
    });

    test('沒讀出金額，但有其他欄位', () {
      expect(
        aiMessage(readResult: 'unreadable', filled: ['日期'], creditsLeft: 1, splitReset: false),
        '沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入',
      );
    });

    test('什麼都沒讀到（包含不是收據）', () {
      expect(
        aiMessage(readResult: 'not_receipt', filled: [], creditsLeft: 1, splitReset: false),
        '沒有讀出金額（已扣 1 點）',
      );
    });
  });

  group('fromMap', () {
    test('callable 回來的巢狀 Map 讀得起來', () {
      final r = AiReadResult.fromMap(<Object?, Object?>{
        'readResult': 'read',
        'creditsLeft': 2,
        'fields': <Object?, Object?>{
          'amount': '1280',
          'currency': 'JPY',
          'currencySupported': true,
          'date': null,
          'time': null,
          'title': 'すき家',
          'category': 'food',
        },
      });
      expect(r.readResult, 'read');
      expect(r.creditsLeft, 2);
      expect(r.fields.amount, '1280');
      expect(r.fields.currencySupported, true);
      expect(r.fields.date, isNull);
    });

    test('欄位缺漏時不丟例外', () {
      final r = AiReadResult.fromMap(<Object?, Object?>{});
      expect(r.readResult, 'unreadable');
      expect(r.creditsLeft, 0);
      expect(r.fields.amount, isNull);
    });
  });
}
