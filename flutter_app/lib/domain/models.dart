/// 結算會用到的資料形狀。`src/types/` 的 Dart 版，只搬結算真的用得到的欄位。
///
/// 刻意不做成完整的 Firestore 文件模型：那一層（序列化、Timestamp、null 相容）
/// 屬於資料存取，會隨 Firestore SDK 走。這裡是純值物件，讓 settlement.dart
/// 可以完全不知道資料從哪來。

/// 一筆支出。
class Expense {
  final String id;
  final String title;

  /// 原幣別的金額，最小單位整數。
  final int amount;
  final String currency;

  /// 記帳當下換算成任務主要幣別的金額。
  ///
  /// 可以是 null —— 加入多幣別之前建立的舊支出沒有這個欄位。那種資料
  /// 只有在「本來就是主要幣別」時算得出來，否則要被排除並告訴使用者。
  final int? baseAmount;

  /// 先付錢的人。
  final String paidBy;

  /// 誰分攤多少，**原幣別**的金額。總和等於 amount。
  final Map<String, int> splits;

  const Expense({
    required this.id,
    required this.title,
    required this.amount,
    required this.currency,
    required this.baseAmount,
    required this.paidBy,
    required this.splits,
  });
}

/// 回國之後的還款。只有 confirmed 的才算數 —— 收款人沒點頭之前，
/// 那筆錢在帳上不存在。
class Payment {
  final String from;
  final String to;
  final int amount;

  /// "pending" 或 "confirmed"。
  final String status;

  const Payment({
    required this.from,
    required this.to,
    required this.amount,
    required this.status,
  });
}

/// 一個人在這趟旅程的收支。balance 為正代表別人欠他。
class MemberBalance {
  final String uid;
  final int paid;
  final int owed;
  final int balance;

  const MemberBalance({
    required this.uid,
    required this.paid,
    required this.owed,
    required this.balance,
  });
}

/// 一筆建議轉帳。
class Transfer {
  final String from;
  final String to;
  final int amount;

  const Transfer({required this.from, required this.to, required this.amount});
}

/// 即時算出來的結算結果。
class Settlement {
  final String currency;
  final int total;
  final int expenseCount;

  /// 已確認付款的總額。
  final int paidTotal;
  final List<MemberBalance> balances;
  final List<Transfer> transfers;

  /// 算不出換算金額而被排除的支出。要讓使用者知道有哪幾筆沒被算進去，
  /// 不能默默跳過 —— 那會讓總額對不上而沒有人知道為什麼。
  final List<Expense> unconverted;

  const Settlement({
    required this.currency,
    required this.total,
    required this.expenseCount,
    required this.paidTotal,
    required this.balances,
    required this.transfers,
    required this.unconverted,
  });
}

/// 要存進 Firestore 的結算快照。
///
/// 暱稱一起存進去，之後有人改暱稱或被移除都不會改寫這份歷史紀錄。
class SettlementSnapshotInput {
  final String currency;
  final int total;
  final int paidTotal;
  final int expenseCount;
  final List<MemberBalance> balances;
  final List<Transfer> transfers;
  final Map<String, String> memberNames;
  final String note;

  const SettlementSnapshotInput({
    required this.currency,
    required this.total,
    required this.paidTotal,
    required this.expenseCount,
    required this.balances,
    required this.transfers,
    required this.memberNames,
    required this.note,
  });
}
