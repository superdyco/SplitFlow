/// 一個成員在這個任務裡留下了哪些帳。
/// `src/utils/memberFootprint.ts` 的 Dart 版。
///
/// 用來回答「移除他之後，結算頁還會不會看到他」——會，因為結算的參與者是從
/// 支出與付款推導的，不是從 `memberIds`。要讓他真的消失就得刪掉這些東西。
///
/// **不必檢查 `splitMemberIds`**：那是自訂分攤之前的舊欄位，`expenseFromMap()`
/// 在讀取時就把它推回 `splits` 了，這裡拿到的一律是正規化之後的模型。
library;

import 'currency.dart';
import 'models.dart';

class MemberFootprint {
  final List<String> expenseIds;
  final List<String> paymentIds;

  /// 上面那些支出裡，有沒有**別人付的**。
  ///
  /// 真實移除會把整筆支出刪掉，所以只有這種時候才會連累到其他人 ——
  /// 他自己付的帳刪掉只影響他自己。對話框靠這個決定要不要出那句警告。
  final bool othersPaid;

  const MemberFootprint({
    required this.expenseIds,
    required this.paymentIds,
    this.othersPaid = false,
  });

  bool get hasRecords => expenseIds.isNotEmpty || paymentIds.isNotEmpty;
}

MemberFootprint memberFootprint(
  String uid,
  List<Expense> expenses,
  List<Payment> payments,
) {
  // containsKey 而不是 `splits[uid] != null` —— 自訂分攤可以給某個人 0 元，
  // 那也算參與。
  final involved = expenses
      .where((e) => e.paidBy == uid || e.splits.containsKey(uid))
      .toList();

  return MemberFootprint(
    expenseIds: involved.map((e) => e.id).toList(),
    paymentIds: payments
        .where((p) => p.from == uid || p.to == uid)
        .map((p) => p.id)
        .toList(),
    othersPaid: involved.any((e) => e.paidBy != uid),
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
///
/// 兩個選項的說明都是**陳述句**，不是問句。這裡曾經直接嵌入一份獨立的確認
/// 訊息（結尾是「確定要移除嗎？」、中間還有空行），變成在選項裡再問一次，
/// 而且餘額不是 0 的時候會在兩個項目符號之間插進空行與一個懸空的問句。
RemoveMemberPrompt removeMemberPrompt({
  required String name,
  required int expenseCount,
  required int paymentCount,

  /// 正數代表還有人要付給他，負數代表他還沒付。
  ///
  /// null 代表**算不出來**（結算還沒載完之類），跟 0 是兩回事 ——
  /// 把兩者混為一談等於在一個不可逆的決定前面謊報「他沒有欠款」。
  required int? balance,
  required String currency,

  /// 虛擬成員沒有帳號，本來就看不到任務，那句後果對他沒有意義。
  bool virtual = false,

  /// 要刪掉的支出裡，有沒有別人付的。有的話刪掉會連累到那些人。
  bool othersPaid = false,
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

  String money(int amount) => '$currency ${formatAmount(amount, currency)}';

  // 虛擬成員從來就沒有帳號，「他之後看不到這個任務」對他不成立。
  final access = virtual ? '' : '他之後看不到這個任務。';

  final owing = balance == null
      ? '目前算不出他的結算餘額。'
      : balance < 0
          ? '他還有 ${money(-balance)} 沒付。'
          : balance > 0
              ? '還有 ${money(balance)} 要付給他。'
              : '';

  // 只有真的會連累別人時才警告。他自己付的帳刪掉只影響他自己。
  final others =
      othersPaid ? '其中有些支出是別人付的，刪掉之後那些人的帳也會跟著不見。' : '';

  return RemoveMemberPrompt(
    title: title,
    message: '$who 出現在 $counts裡。\n\n'
        '・保留結算資料：把他從成員名單移除，那 $counts與結算金額都保留。'
        '$access$owing\n\n'
        '・真實移除：連同那 $counts一起刪除，無法復原。'
        '$others結算紀錄裡仍然看得到他的名字。',
    hasRecords: true,
  );
}
