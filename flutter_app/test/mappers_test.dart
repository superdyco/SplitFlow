import 'package:test/test.dart';
import 'package:splitflow/data/mappers.dart';
import 'package:splitflow/domain/expense_date.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/settlement.dart';

/// 文件轉換層的測試。
///
/// 這一層的工作幾乎全是「吞下各種舊形狀」，所以測試也幾乎全在測缺欄位。
/// 每一條對應一次真實的 schema 變更 —— 補值補錯的話，那個年代建立的支出
/// 會整批讀不出來或算錯錢。
void main() {
  group('expenseFromMap 的完整資料', () {
    test('欄位都齊時原樣轉過來', () {
      final expense = expenseFromMap(
        'e1',
        {
          'title': '晚餐',
          'amount': 45000,
          'currency': 'TWD',
          'baseAmount': 45000,
          'paidBy': 'a',
          'splits': {'a': 22500, 'b': 22500},
          'category': 'food',
          'splitMode': 'even',
          'date': '2026-06-15',
          'time': '19:30',
          'place': {'name': '路邊攤', 'lat': 13.75, 'lng': 100.5},
        },
        DateTime(2026, 6, 15, 20, 0),
      );

      expect(expense.id, 'e1');
      expect(expense.title, '晚餐');
      expect(expense.amount, 45000);
      expect(expense.baseAmount, 45000);
      expect(expense.splits, {'a': 22500, 'b': 22500});
      expect(expense.category, ExpenseCategory.food);
      expect(expense.date, '2026-06-15');
      expect(expense.time, '19:30');
      expect(expense.place?.name, '路邊攤');
      expect(expense.place?.lat, 13.75);
    });
  });

  group('expenseFromMap 吞舊資料', () {
    test('自訂分攤之前：沒有 splits，從 splitMemberIds 均分推回來', () {
      final expense = expenseFromMap(
        'old',
        {
          'title': '舊支出',
          'amount': 100,
          'currency': 'TWD',
          'paidBy': 'a',
          'splitMemberIds': ['a', 'b', 'c'],
        },
        null,
      );

      // 用同一支 allocate，餘數的分法才會跟結算頁一致。
      expect(expense.splits, {'a': 34, 'b': 33, 'c': 33});
      expect(expense.splits.values.fold<int>(0, (x, y) => x + y), 100);
    });

    test('連 splitMemberIds 都沒有時是空的分攤，不會爆', () {
      final expense = expenseFromMap(
        'old',
        {'title': '舊支出', 'amount': 100, 'currency': 'TWD', 'paidBy': 'a'},
        null,
      );
      expect(expense.splits, isEmpty);
    });

    test('多幣別之前：沒有 baseAmount 是 null，同幣別時結算會自己沿用 amount', () {
      final expense = expenseFromMap(
        'old',
        {'title': '舊支出', 'amount': 45000, 'currency': 'TWD', 'paidBy': 'a'},
        null,
      );

      expect(expense.baseAmount, isNull);
      // 同幣別時算得出來。
      expect(baseAmountOf(expense, 'TWD'), 45000);
      // 外幣就算不出來，會被結算排除並列給使用者看。
      expect(baseAmountOf(expense, 'JPY'), isNull);
    });

    test('日期欄位之前：沒有 date 時退回 createdAt 的日期', () {
      final expense = expenseFromMap(
        'old',
        {'title': '舊支出', 'amount': 100, 'currency': 'TWD', 'paidBy': 'a'},
        DateTime(2026, 6, 15, 10, 0),
      );

      expect(expense.date, isNull);
      expect(expenseDate(expense), '2026-06-15');
    });

    test('date 是空字串跟沒有這個欄位一樣 —— 不然會多出一個叫「」的日期群組', () {
      final expense = expenseFromMap(
        'e1',
        {
          'title': '支出',
          'amount': 100,
          'currency': 'TWD',
          'paidBy': 'a',
          'date': '',
        },
        DateTime(2026, 6, 15),
      );

      expect(expense.date, isNull);
      expect(expenseDate(expense), '2026-06-15');
    });

    test('沒有 splitMode 時當成均分', () {
      final expense = expenseFromMap(
        'old',
        {'title': '舊支出', 'amount': 100, 'currency': 'TWD', 'paidBy': 'a'},
        null,
      );
      expect(expense.splitMode, SplitMode.even);
    });

    test('沒看過的分類歸「其他」，不會讓整筆支出消失', () {
      final expense = expenseFromMap(
        'e1',
        {
          'title': '支出',
          'amount': 100,
          'currency': 'TWD',
          'paidBy': 'a',
          'category': '未來才會有的分類',
        },
        null,
      );
      expect(expense.category, ExpenseCategory.other);
    });

    test('地點只有名字時座標是 null，不會假造 0', () {
      final expense = expenseFromMap(
        'e1',
        {
          'title': '支出',
          'amount': 100,
          'currency': 'TWD',
          'paidBy': 'a',
          'place': {'name': '只打了名字'},
        },
        null,
      );
      expect(expense.place?.name, '只打了名字');
      expect(expense.place?.lat, isNull);
    });

    test('地點是空物件或沒有名字時整個當成沒有地點', () {
      for (final place in [<String, dynamic>{}, {'name': ''}, null]) {
        final expense = expenseFromMap(
          'e1',
          {
            'title': '支出',
            'amount': 100,
            'currency': 'TWD',
            'paidBy': 'a',
            'place': place,
          },
          null,
        );
        expect(expense.place, isNull);
      }
    });

    test('金額是 double 時收斂成 int —— 浮點數不碰錢', () {
      // 經由 JSON 匯入的資料可能把整數存成 double。
      final expense = expenseFromMap(
        'e1',
        {
          'title': '支出',
          'amount': 45000.0,
          'currency': 'TWD',
          'paidBy': 'a',
          'splits': {'a': 45000.0},
        },
        null,
      );

      expect(expense.amount, 45000);
      expect(expense.amount, isA<int>());
      expect(expense.splits['a'], isA<int>());
    });

    test('整份文件幾乎全空也讀得出來，不會丟例外', () {
      final expense = expenseFromMap('broken', {}, null);
      expect(expense.id, 'broken');
      expect(expense.amount, 0);
      expect(expense.title, '');
    });
  });

  group('收據欄位', () {
    ExpenseReceipt? receiptOf(dynamic value) =>
        expenseFromMap('e1', {'receipt': value}, null).receipt;

    test('已經傳上去的', () {
      final receipt = receiptOf({'path': 'tasks/t1/expenses/e1/receipt.jpg'});
      expect(receipt?.uploaded, isTrue);
      expect(receipt?.pending, isFalse);
      expect(receipt?.path, 'tasks/t1/expenses/e1/receipt.jpg');
    });

    test('網頁版排隊中的 —— 原生版讀得懂，但那張圖在另一台裝置上', () {
      final receipt = receiptOf({'path': null, 'localId': 'abc'});
      expect(receipt?.pending, isTrue);
      expect(receipt?.uploaded, isFalse);
    });

    test('傳完之後 localId 會被清成 null，那時算已上傳', () {
      final receipt =
          receiptOf({'path': 'tasks/t1/expenses/e1/receipt.jpg', 'localId': null});
      expect(receipt?.uploaded, isTrue);
      expect(receipt?.pending, isFalse);
    });

    test('收據功能之前的支出沒有這個欄位', () {
      expect(expenseFromMap('e1', {}, null).receipt, isNull);
    });

    test('兩個欄位都空的等於沒有收據 —— 不要讓呼叫端判斷兩次', () {
      expect(receiptOf({}), isNull);
      expect(receiptOf({'path': '', 'localId': ''}), isNull);
      expect(receiptOf({'path': null, 'localId': null}), isNull);
    });

    test('形狀不對的當作沒有，不要丟例外', () {
      expect(receiptOf('receipt.jpg'), isNull);
      expect(receiptOf(42), isNull);
    });
  });

  group('paymentFromMap', () {
    test('confirmed 照實轉', () {
      final payment = paymentFromMap('p1', {
        'from': 'a',
        'to': 'b',
        'amount': 30000,
        'status': 'confirmed',
      });
      expect(payment.status, 'confirmed');
      expect(payment.amount, 30000);
    });

    test('認不得的狀態當成 pending —— 猜錯的方向要是「少扣」而不是「多扣」', () {
      for (final status in ['pending', '沒看過的狀態', null]) {
        final payment = paymentFromMap('p1', {
          'from': 'a',
          'to': 'b',
          'amount': 30000,
          'status': status,
        });
        expect(payment.status, 'pending');
      }
    });
  });
}
