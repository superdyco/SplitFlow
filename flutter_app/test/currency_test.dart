import 'package:test/test.dart';
import 'package:splitflow/domain/currency.dart';

/// `tests/currency.test.ts` 的 Dart 版。
///
/// 案例是一比一搬過來的，不是重寫的 —— 這樣兩邊跑出來的結果只要有一個
/// 對不上，就是移植出了問題，而不是「兩邊本來就在測不同的東西」。
void main() {
  group('minorUnits', () {
    test('沒有小數的幣別是 0 位', () {
      expect(minorUnits('VND'), 0);
      expect(minorUnits('KRW'), 0);
      // 日圓最容易被誤當成 2 位 —— 它跟美元一樣有「元」的感覺，但 1 円就是最小單位。
      expect(minorUnits('JPY'), 0);
    });

    test('其他幣別預設 2 位', () {
      expect(minorUnits('TWD'), 2);
      expect(minorUnits('沒聽過的幣別'), 2);
    });
  });

  group('parseAmountInput', () {
    test('換成最小單位整數', () {
      expect(parseAmountInput('450', 'TWD'), 45000);
      expect(parseAmountInput('450.5', 'TWD'), 45050);
      expect(parseAmountInput('0.07', 'TWD'), 7);
      expect(parseAmountInput(' 1234.05 ', 'TWD'), 123405);
    });

    test('0 位小數的幣別不放大', () {
      expect(parseAmountInput('50000', 'VND'), 50000);
    });

    test('擋掉不合法的輸入', () {
      expect(() => parseAmountInput('', 'TWD'), throwsFormatException);
      expect(() => parseAmountInput('0', 'TWD'), throwsFormatException);
      expect(() => parseAmountInput('-5', 'TWD'), throwsFormatException);
      expect(() => parseAmountInput('1.234', 'TWD'), throwsFormatException);
      expect(() => parseAmountInput('1.5', 'KRW'), throwsFormatException);
      expect(() => parseAmountInput('abc', 'TWD'), throwsFormatException);
    });
  });

  group('formatAmount / amountToInput', () {
    test('補小數位並加千分位', () {
      expect(formatAmount(45050, 'TWD'), '450.50');
      expect(formatAmount(123456789, 'TWD'), '1,234,567.89');
      expect(formatAmount(7, 'TWD'), '0.07');
      expect(formatAmount(50000, 'VND'), '50,000');
    });

    test('負數保留負號', () {
      expect(formatAmount(-45050, 'TWD'), '-450.50');
    });

    test('回填表單時不帶千分位', () {
      expect(amountToInput(123456789, 'TWD'), '1234567.89');
      expect(amountToInput(50000, 'VND'), '50000');
    });

    test('格式化再解析回來要是同一個數字', () {
      for (final amount in [1, 7, 45050, 123456789]) {
        expect(parseAmountInput(amountToInput(amount, 'TWD'), 'TWD'), amount);
      }
      expect(parseAmountInput(amountToInput(50000, 'VND'), 'VND'), 50000);
    });
  });

  group('allocate', () {
    test('總和永遠等於 total，一分錢都不會多也不會少', () {
      for (final total in [100, 101, 999, 1000, 10007]) {
        for (final people in [1, 2, 3, 7, 15]) {
          final shares = allocate(total, List<int>.filled(people, 1));
          expect(shares.fold<int>(0, (a, b) => a + b), total);
          expect(shares.length, people);
        }
      }
    });

    test('除不盡時餘數給前面的人，而且是確定的', () {
      // 10 除以 3 是 3.33...，餘數 1 給索引最小的那個。
      expect(allocate(10, [1, 1, 1]), [4, 3, 3]);
      expect(allocate(100, [1, 1, 1]), [34, 33, 33]);
    });

    test('同一組輸入永遠拆出同一個答案', () {
      final first = allocate(100, [3, 3, 3, 1]);
      final second = allocate(100, [3, 3, 3, 1]);
      expect(first, second);
    });

    test('依權重比例分配', () {
      expect(allocate(100, [1, 3]), [25, 75]);
      expect(allocate(1000, [1, 1, 2]), [250, 250, 500]);
    });

    test('權重全是 0 就退回均分 —— 不能整組變成 0', () {
      final shares = allocate(90, [0, 0, 0]);
      expect(shares, [30, 30, 30]);
      expect(shares.fold<int>(0, (a, b) => a + b), 90);
    });

    test('空的權重回空陣列，不會爆', () {
      expect(allocate(100, []), <int>[]);
    });

    test('15 人除不盡也對得起來 —— 越南那份壓測資料的情境', () {
      final shares = allocate(250000, List<int>.filled(15, 1));
      expect(shares.fold<int>(0, (a, b) => a + b), 250000);
      // 250000 / 15 = 16666.67，前 10 個拿 16667，其餘 16666。
      expect(shares.where((s) => s == 16667).length, 10);
      expect(shares.where((s) => s == 16666).length, 5);
    });
  });

  group('convertAmount', () {
    test('同幣別直接回原金額', () {
      expect(convertAmount(45000, 'TWD', 'TWD', 1), 45000);
    });

    test('兩邊小數位數不同要各自換算', () {
      // JPY 12400（0 位）× 0.2105 = TWD 2610.2 → 261020（2 位）
      expect(convertAmount(12400, 'JPY', 'TWD', 0.2105), 261020);
      // VND 1050000（0 位）× 0.00126 = TWD 1323 → 132300
      expect(convertAmount(1050000, 'VND', 'TWD', 0.00126), 132300);
    });
  });

  group('parseRateInput', () {
    test('最多六位小數', () {
      expect(parseRateInput('0.2105'), 0.2105);
      expect(parseRateInput('31.5'), 31.5);
      expect(() => parseRateInput('0.1234567'), throwsFormatException);
      expect(() => parseRateInput('0'), throwsFormatException);
      expect(() => parseRateInput(''), throwsFormatException);
      expect(() => parseRateInput('abc'), throwsFormatException);
    });
  });

  group('amountInputError / rateInputError', () {
    test('還沒開始輸入時不嘮叨', () {
      expect(amountInputError('', 'TWD'), isNull);
      expect(rateInputError('   '), isNull);
    });

    test('合法就沒有訊息', () {
      expect(amountInputError('450.50', 'TWD'), isNull);
      expect(rateInputError('0.2105'), isNull);
    });

    test('換幣別之後不合法要講得出原因 —— 不能只讓按鈕默默變灰', () {
      // 這一條釘住的是實際發生過的 bug：在 THB 合法的 450.50 換成 VND 就不合法。
      expect(amountInputError('450.50', 'THB'), isNull);
      expect(amountInputError('450.50', 'VND'), 'VND 金額只能是整數');
    });
  });

  // 以下是 `tests/currencySearch.test.ts` 的 Dart 版，案例一比一。
  group('幣別清單', () {
    test('20 種，代碼不重複', () {
      expect(currencies.length, 20);
      expect(currencies.toSet().length, 20);
    });

    test('原本的十種一個都沒少 —— 既有任務與支出存的就是這些代碼', () {
      for (final code in ['TWD', 'JPY', 'THB', 'USD', 'VND', 'CNY', 'EGP', 'KRW', 'EUR', 'HKD']) {
        expect(currencies, contains(code));
      }
    });

    test('這次加的十種都在', () {
      for (final code in ['SGD', 'MYR', 'PHP', 'IDR', 'MOP', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD']) {
        expect(currencies, contains(code));
      }
    });

    test('每一種都有中文名', () {
      expect(currencyInfo.every((item) => item.name.isNotEmpty), isTrue);
    });
  });

  group('minorUnits（新幣別）', () {
    test('印尼盾實際上不用小數，跟日圓一樣是 0 位', () {
      expect(minorUnits('IDR'), 0);
    });

    test('其他新幣別是 2 位', () {
      for (final code in ['SGD', 'MYR', 'PHP', 'MOP', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD']) {
        expect(minorUnits(code), 2);
      }
    });
  });

  group('currencyLabel', () {
    test('代碼在前、中文在後', () {
      expect(currencyLabel('USD'), 'USD 美元');
      expect(currencyLabel('JPY'), 'JPY 日圓');
    });

    test('認不得的代碼原樣回傳，不會變成空白', () {
      expect(currencyLabel('XXX'), 'XXX');
    });
  });

  group('searchCurrencies', () {
    List<String> codes(List<CurrencyInfo> list) => [for (final item in list) item.code];

    test('沒打字時是整份清單，主要幣別排第一', () {
      final result = codes(searchCurrencies('', pinned: 'JPY'));
      expect(result.first, 'JPY');
      expect(result.length, 20);
    });

    test('打代碼開頭找得到，不分大小寫', () {
      expect(codes(searchCurrencies('us')).first, 'USD');
      expect(codes(searchCurrencies('US')).first, 'USD');
    });

    test('代碼開頭相符的排在只是包含的前面', () {
      final result = codes(searchCurrencies('n'));
      expect(result.first, 'NZD');
      expect(result, contains('CNY'));
      expect(result, contains('VND'));
    });

    test('打中文名找得到', () {
      expect(codes(searchCurrencies('美元')), ['USD']);
      expect(codes(searchCurrencies('泰銖')), ['THB']);
    });

    test('打國家或俗稱也找得到', () {
      expect(codes(searchCurrencies('日本')), ['JPY']);
      expect(codes(searchCurrencies('美國')), ['USD']);
      expect(codes(searchCurrencies('美金')), ['USD']);
      expect(codes(searchCurrencies('峇里島')), ['IDR']);
    });

    test('「澳」同時找到澳幣與澳門幣', () {
      final result = codes(searchCurrencies('澳'));
      expect(result, contains('AUD'));
      expect(result, contains('MOP'));
    });

    test('有打字時主要幣別也排在同一級的最前面', () {
      expect(codes(searchCurrencies('新', pinned: 'SGD')).first, 'SGD');
    });

    test('前後空白不影響', () {
      expect(codes(searchCurrencies('  usd  ')).first, 'USD');
    });

    test('找不到時回空清單', () {
      expect(searchCurrencies('zzz'), isEmpty);
    });
  });
}
