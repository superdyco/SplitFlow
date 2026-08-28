/// 一個成員在這個任務裡留下了哪些帳。
/// `src/utils/memberFootprint.ts` 的 Dart 版。
///
/// 用來回答「移除他之後，結算頁還會不會看到他」——會，因為結算的參與者是從
/// 支出與付款推導的，不是從 `memberIds`。要讓他真的消失就得刪掉這些東西。
///
/// **不必檢查 `splitMemberIds`**：那是自訂分攤之前的舊欄位，`expenseFromMap()`
/// 在讀取時就把它推回 `splits` 了，這裡拿到的一律是正規化之後的模型。
library;

import 'expense_actions.dart';
import 'models.dart';

class MemberFootprint {
  final List<String> expenseIds;
  final List<String> paymentIds;

  const MemberFootprint({required this.expenseIds, required this.paymentIds});

  bool get hasRecords => expenseIds.isNotEmpty || paymentIds.isNotEmpty;
}

MemberFootprint memberFootprint(
  String uid,
  List<Expense> expenses,
  List<Payment> payments,
) {
  return MemberFootprint(
    // containsKey 而不是 `splits[uid] != null` —— 自訂分攤可以給某個人 0 元，
    // 那也算參與。
    expenseIds: expenses
        .where((e) => e.paidBy == uid || e.splits.containsKey(uid))
        .map((e) => e.id)
        .toList(),
    paymentIds: payments
        .where((p) => p.from == uid || p.to == uid)
        .map((p) => p.id)
        .toList(),
  );
}

class RemoveMemberPrompt {
  final String title;
  final String message;

  /// true 代表要給「保留 / 真實移除」兩個選擇；false 代表直接刪。
  final bool hasRecords;

  const RemoveMemberPrompt({
    required this.title,
    required this.message,
    required this.hasRecords,
  });
}

/// 移除成員的對話框內容。`src/utils/memberRemoval.ts` 的 `removeMemberPrompt`
/// 的 Dart 版。
///
/// 沒有帳的人不給選擇 —— 沒東西可失去，多問一次只是擋路。
///
/// 刻意**不要求打出名字**：那層摩擦留給刪整個任務（`taskActionPrompt`），
/// 成員移除已經有兩段式的選擇，而且訊息裡把後果都講明了。
RemoveMemberPrompt removeMemberPrompt({
  required String name,
  required int expenseCount,
  required int paymentCount,
  required int balance,
  required String currency,
}) {
  final who = name.isEmpty ? '這位成員' : name;
  final title = '移除「$who」';

  if (expenseCount == 0 && paymentCount == 0) {
    return RemoveMemberPrompt(
      title: title,
      message: '$who 還沒有任何支出與付款記錄，會直接從這個任務移除。',
      hasRecords: false,
    );
  }

  // 只列真的有的那幾項，不然會出現「0 筆支出」這種讀起來很怪的句子。
  final counts = [
    if (expenseCount > 0) '$expenseCount 筆支出',
    if (paymentCount > 0) '$paymentCount 筆付款記錄',
  ].join('、');

  final keep = removeMemberMessage(
    name: who,
    balance: balance,
    currency: currency,
  );

  return RemoveMemberPrompt(
    title: title,
    message: '${who} 出現在 ${counts}裡。\n\n'
        '・保留結算資料：$keep\n\n'
        '・真實移除：連同那 ${counts}一起刪除，無法復原。'
        '其中有些支出是別人付的，刪掉之後那些人的帳也會跟著不見。'
        '結算紀錄裡仍然看得到他的名字。',
    hasRecords: true,
  );
}
