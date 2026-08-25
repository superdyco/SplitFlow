import 'currency.dart';
import 'models.dart';

/// 結算。`src/utils/settlement.ts` 的 Dart 版。
///
/// 這裡有兩個不變條件，測試釘死它們，改動時只要有一條破了就是算錯了：
///
///   1. 每種情境下 balance 的總和都是 0（錢不會憑空出現或消失）
///   2. 轉帳金額的總和等於所有應付的總和
///
/// 純函式，不 import Flutter 也不 import Firestore。

/// 依成員加入順序排出參與者，任務成員在前，已離開但還出現在支出裡的排在後面。
List<String> _orderParticipants(Set<String> uids, List<String> memberOrder) {
  final known = memberOrder.where(uids.contains).toList();
  final knownSet = known.toSet();
  final extra = uids.where((uid) => !knownSet.contains(uid)).toList()..sort();
  return [...known, ...extra];
}

/// 支出換算成主要幣別後，每個人分攤多少。
///
/// 用原幣別的分攤金額當權重去分配 baseAmount，所以換算後的總和一定還是等於
/// baseAmount，不會因為每筆各自四捨五入而多出或少掉幾分錢。
Map<String, int> baseSplitsOf(
  Expense expense,
  int baseAmount,
  List<String> memberOrder,
) {
  final uids = _orderParticipants(expense.splits.keys.toSet(), memberOrder);
  final shares = allocate(
    baseAmount,
    uids.map((uid) => expense.splits[uid] ?? 0).toList(),
  );
  return {for (var i = 0; i < uids.length; i += 1) uids[i]: shares[i]};
}

/// 記帳當下換算好的金額，同幣別的舊資料可以直接沿用原金額。
int? baseAmountOf(Expense expense, String baseCurrency) {
  if (expense.baseAmount != null) return expense.baseAmount;
  return expense.currency == baseCurrency ? expense.amount : null;
}

class _Party {
  final String uid;
  int amount;
  _Party(this.uid, this.amount);
}

/// 貪婪配對：金額最大的應付對上金額最大的應收，讓轉帳筆數盡量少。
List<Transfer> _buildTransfers(List<MemberBalance> balances) {
  // 平手時比 uid，理由跟 allocate 裡那段一樣：Dart 的 sort 不保證穩定，
  // 少了 tiebreaker 兩個版本可能排出不同的順序，建議轉帳就會長得不一樣。
  int byAmountDesc(_Party a, _Party b) {
    final byAmount = b.amount.compareTo(a.amount);
    return byAmount != 0 ? byAmount : a.uid.compareTo(b.uid);
  }

  final creditors = balances
      .where((item) => item.balance > 0)
      .map((item) => _Party(item.uid, item.balance))
      .toList()
    ..sort(byAmountDesc);
  final debtors = balances
      .where((item) => item.balance < 0)
      .map((item) => _Party(item.uid, -item.balance))
      .toList()
    ..sort(byAmountDesc);

  final transfers = <Transfer>[];
  var debtorIndex = 0;
  var creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    final debtor = debtors[debtorIndex];
    final creditor = creditors[creditorIndex];
    final amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;

    if (amount > 0) {
      transfers.add(Transfer(from: debtor.uid, to: creditor.uid, amount: amount));
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount == 0) debtorIndex += 1;
    if (creditor.amount == 0) creditorIndex += 1;
  }

  return transfers;
}

/// 從真實支出與已確認的付款算出結算結果，全部換算成任務的主要幣別。
///
/// 換算用的是記帳當下存進支出的匯率，不是現在的匯率，所以同一筆帳今天看跟
/// 昨天看是一樣的。
///
/// 付款在數學上就是一筆「付款人先付、收款人獨自分攤」的支出，所以直接併進
/// 同一組帳裡算，剩下的建議轉帳會自動扣掉已經付掉的部分。還沒被收款人確認的
/// 付款不算數。
Settlement settleExpenses(
  List<Expense> expenses,
  List<Payment> payments,
  List<String> memberOrder,
  String baseCurrency,
) {
  final paid = <String, int>{};
  final owed = <String, int>{};
  final participants = <String>{};
  final unconverted = <Expense>[];
  var total = 0;
  var counted = 0;
  var paidTotal = 0;

  for (final expense in expenses) {
    final baseAmount = baseAmountOf(expense, baseCurrency);
    if (baseAmount == null) {
      unconverted.add(expense);
      continue;
    }

    total += baseAmount;
    counted += 1;
    participants.add(expense.paidBy);
    paid[expense.paidBy] = (paid[expense.paidBy] ?? 0) + baseAmount;

    baseSplitsOf(expense, baseAmount, memberOrder).forEach((uid, share) {
      participants.add(uid);
      owed[uid] = (owed[uid] ?? 0) + share;
    });
  }

  for (final payment in payments) {
    if (payment.status != 'confirmed') continue;
    paidTotal += payment.amount;
    participants.add(payment.from);
    participants.add(payment.to);
    paid[payment.from] = (paid[payment.from] ?? 0) + payment.amount;
    owed[payment.to] = (owed[payment.to] ?? 0) + payment.amount;
  }

  final balances = _orderParticipants(participants, memberOrder).map((uid) {
    final paidAmount = paid[uid] ?? 0;
    final owedAmount = owed[uid] ?? 0;
    return MemberBalance(
      uid: uid,
      paid: paidAmount,
      owed: owedAmount,
      balance: paidAmount - owedAmount,
    );
  }).toList();

  return Settlement(
    currency: baseCurrency,
    total: total,
    expenseCount: counted,
    paidTotal: paidTotal,
    balances: balances,
    transfers: _buildTransfers(balances),
    unconverted: unconverted,
  );
}

/// 把即時算出來的結算轉成可以存進 Firestore 的快照。
SettlementSnapshotInput toSnapshotInput(
  Settlement settlement,
  Map<String, String> memberNames,
  String note,
) {
  final involved = settlement.balances.map((item) => item.uid).toSet();
  return SettlementSnapshotInput(
    currency: settlement.currency,
    total: settlement.total,
    paidTotal: settlement.paidTotal,
    expenseCount: settlement.expenseCount,
    // 存複本。之後改動原本的結算不該回頭改寫這份歷史紀錄。
    balances: settlement.balances
        .map((item) => MemberBalance(
              uid: item.uid,
              paid: item.paid,
              owed: item.owed,
              balance: item.balance,
            ))
        .toList(),
    transfers: settlement.transfers
        .map((item) => Transfer(from: item.from, to: item.to, amount: item.amount))
        .toList(),
    memberNames: {
      for (final uid in involved) uid: memberNames[uid] ?? '已離開的成員',
    },
    note: note,
  );
}

/// 目前的帳目跟這份快照存下來時是不是一樣。
///
/// 用來提示「上次結算之後又有新的變動」，只看會影響誰欠誰的欄位 ——
/// 備註改了不算變動。
bool matchesSnapshot(Settlement settlement, SettlementSnapshotInput snapshot) {
  if (settlement.currency != snapshot.currency) return false;
  if (settlement.total != snapshot.total) return false;
  if (settlement.paidTotal != snapshot.paidTotal) return false;
  if (settlement.expenseCount != snapshot.expenseCount) return false;
  if (settlement.balances.length != snapshot.balances.length) return false;

  final before = {for (final item in snapshot.balances) item.uid: item.balance};
  return settlement.balances.every((item) => before[item.uid] == item.balance);
}
