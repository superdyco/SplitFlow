import 'package:splitflow/data/mappers.dart';
import 'package:splitflow/domain/models.dart';
import 'package:test/test.dart';

/// 結算快照的文件轉換。
///
/// 這一層特別要緊：快照是**歷史紀錄**，讀錯就是把當時講好的數字顯示錯，
/// 而且沒有別的地方可以對照 —— 原始支出早就變了。
void main() {
  const input = SettlementSnapshotInput(
    currency: 'TWD',
    total: 12000,
    paidTotal: 12000,
    expenseCount: 3,
    balances: [
      MemberBalance(uid: 'a', paid: 12000, owed: 6000, balance: 6000),
      MemberBalance(uid: 'b', paid: 0, owed: 6000, balance: -6000),
    ],
    transfers: [Transfer(from: 'b', to: 'a', amount: 6000)],
    memberNames: {'a': '小美', 'b': '阿明'},
    note: '回國當天結算',
  );

  group('寫出去再讀回來', () {
    test('每個欄位都對得起來', () {
      final snapshot = settlementFromMap('s1', settlementToMap(input), null);
      final data = snapshot.data;

      expect(snapshot.id, 's1');
      expect(data.currency, 'TWD');
      expect(data.total, 12000);
      expect(data.paidTotal, 12000);
      expect(data.expenseCount, 3);
      expect(data.note, '回國當天結算');
      expect(data.memberNames, {'a': '小美', 'b': '阿明'});

      expect(data.balances.length, 2);
      expect(data.balances.first.uid, 'a');
      expect(data.balances.first.balance, 6000);

      expect(data.transfers.single.from, 'b');
      expect(data.transfers.single.to, 'a');
      expect(data.transfers.single.amount, 6000);
    });

    test('存的是當時的暱稱 —— 之後改名不該改寫歷史', () {
      final map = settlementToMap(input);
      expect(map['memberNames'], {'a': '小美', 'b': '阿明'});
    });
  });

  group('壞掉或缺欄位的文件', () {
    test('整份空的也讀得出來，不會丟例外', () {
      final snapshot = settlementFromMap('s1', {}, null);
      expect(snapshot.data.total, 0);
      expect(snapshot.data.balances, isEmpty);
      expect(snapshot.data.transfers, isEmpty);
      expect(snapshot.data.memberNames, isEmpty);
      expect(snapshot.data.note, '');
    });

    test('陣列欄位形狀不對就當作空的', () {
      final snapshot = settlementFromMap('s1', {
        'balances': 'nope',
        'transfers': 42,
        'memberNames': [1, 2],
      }, null);
      expect(snapshot.data.balances, isEmpty);
      expect(snapshot.data.transfers, isEmpty);
      expect(snapshot.data.memberNames, isEmpty);
    });

    test('陣列裡混進不是 Map 的東西，跳過那一筆而不是整份丟掉', () {
      final snapshot = settlementFromMap('s1', {
        'balances': [
          'junk',
          {'uid': 'a', 'balance': 100},
        ],
      }, null);
      expect(snapshot.data.balances.length, 1);
      expect(snapshot.data.balances.single.uid, 'a');
    });

    test('createdAt 是 null 也可以 —— 離線存的還沒有伺服器時間', () {
      expect(settlementFromMap('s1', {}, null).createdAt, isNull);
    });
  });
}
