import 'package:test/test.dart';
import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/settlement_summary.dart';

/// 摘要卡的兩條規則。`tests/settlementSummary.test.ts` 的 Dart 版。
///
/// 這一輪的改動幾乎全是版面，測不到 —— 但這兩個函式不是版面，是「摘要卡
/// 上那個數字是什麼」。而且它們錯掉的方式特別壞：畫面完全正常，只是數字
/// 是另一個意思。
void main() {
  MemberBalance balance(String uid, {int paid = 0, int owed = 0, int bal = 0}) {
    return MemberBalance(uid: uid, paid: paid, owed: owed, balance: bal);
  }

  group('myOwed', () {
    test('拿的是 owed 不是 balance', () {
      /*
        這一條是整個檔案存在的理由。owed 是「我該分攤多少」，
        balance 是「我多付或少付了多少」—— 兩個都是合理的數字，
        寫錯的畫面看起來完全正常，只是講的是另一件事。

        所以這裡刻意讓兩者差很多。
      */
      final balances = [balance('me', paid: 5000, owed: 1200, bal: 3800)];

      expect(myOwed(balances, 'me'), 1200);
    });

    test('找不到我就是 0 —— 沒參與任何支出的人不在 balances 裡', () {
      expect(myOwed([balance('other', owed: 900)], 'me'), 0);
    });

    test('空清單也是 0', () {
      expect(myOwed(const [], 'me'), 0);
    });
  });

  group('myTransfers', () {
    const a = Transfer(from: 'me', to: 'amy', amount: 1240);
    const b = Transfer(from: 'ben', to: 'me', amount: 860);
    const c = Transfer(from: 'ben', to: 'amy', amount: 500);

    test('只留跟我有關的', () {
      final result = myTransfers(const [a, b, c], 'me');

      expect(result.lines.length, 2);
      expect(result.lines.map((line) => line.amount), [1240, 860]);
    });

    test('outgoing 分辨方向 —— from 是我才是我要付出去', () {
      final result = myTransfers(const [a, b], 'me');

      expect(result.lines[0].outgoing, isTrue);
      expect(result.lines[1].outgoing, isFalse);
    });

    test('超過 max 的收進 rest，不是丟掉', () {
      final many = [
        const Transfer(from: 'me', to: 'a', amount: 1),
        const Transfer(from: 'me', to: 'b', amount: 2),
        const Transfer(from: 'me', to: 'c', amount: 3),
        const Transfer(from: 'me', to: 'd', amount: 4),
        const Transfer(from: 'me', to: 'e', amount: 5),
      ];

      final result = myTransfers(many, 'me');

      expect(result.lines.length, 3);
      expect(result.rest, 2);
    });

    test('沒超過 max 時 rest 是 0，不是負數', () {
      final result = myTransfers(const [a], 'me');

      expect(result.rest, 0);
    });

    test('已結清 —— 沒有跟我有關的轉帳', () {
      final result = myTransfers(const [c], 'me');

      expect(result.lines, isEmpty);
      expect(result.rest, 0);
    });
  });
}
