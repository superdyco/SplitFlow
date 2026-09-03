/// 摘要卡要顯示什麼。規則放這裡而不是 widget 裡，widget 只負責畫。
/// `src/utils/settlementSummary.ts` 的 Dart 版。
///
/// 純值運算，不 import Flutter。
library;

import 'models.dart';

/// 摘要卡上的一列轉帳。
class SummaryLine {
  final String from;
  final String to;
  final int amount;

  /// true 代表這筆是「我要付出去」。
  final bool outgoing;

  const SummaryLine({
    required this.from,
    required this.to,
    required this.amount,
    required this.outgoing,
  });
}

/// [myTransfers] 的結果：要畫的幾列，加上被截掉的筆數。
class MyTransfers {
  final List<SummaryLine> lines;
  final int rest;

  const MyTransfers({required this.lines, required this.rest});
}

/// 摘要卡上跟我有關的轉帳。
///
/// 最少轉帳次數的演算法很少讓一個人牽涉到很多筆，[max] 實務上幾乎碰不到 ——
/// 但沒有它，摘要卡可以無限長。被截掉的筆數用 rest 回報，不是默默丟掉。
MyTransfers myTransfers(List<Transfer> transfers, String uid, {int max = 3}) {
  final mine = transfers
      .where((item) => item.from == uid || item.to == uid)
      .toList();

  return MyTransfers(
    lines: mine
        .take(max)
        .map(
          (item) => SummaryLine(
            from: item.from,
            to: item.to,
            amount: item.amount,
            outgoing: item.from == uid,
          ),
        )
        .toList(),
    rest: mine.length > max ? mine.length - max : 0,
  );
}

/// 我該分攤多少。
///
/// 是 owed 不是 balance —— balance 是「我多付或少付了多少」，那是另一件事，
/// 而兩者寫錯的畫面看起來完全正常。
///
/// 找不到我就是 0：沒參與任何一筆支出的人不會出現在 balances 裡，
/// 那時候該顯示 0 而不是空白。
int myOwed(List<MemberBalance> balances, String uid) {
  for (final item in balances) {
    if (item.uid == uid) return item.owed;
  }
  return 0;
}
