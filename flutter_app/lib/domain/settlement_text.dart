import 'currency.dart';
import 'models.dart';

/// 把結算結果變成可以貼進聊天室的純文字。
/// `src/utils/settlementText.ts` 的 Dart 版。

const String _divider = '────────────────';
const String _settled = '大家都已結清，不需要轉帳。';
const String _unknownMember = '已離開的成員';

class SettlementTextInput {
  final String taskName;
  final String currency;
  final List<Transfer> transfers;

  /// uid 對暱稱。即時結算由成員列表組出來，快照用自己存的那份。
  final Map<String, String> memberNames;
  final int expenseCount;
  final int total;

  /// 缺匯率、沒被算進結算的支出筆數。快照沒有這個概念，給 0 即可。
  final int unconvertedCount;

  /// 還沒扣進轉帳金額的待確認付款筆數。快照給 0 即可。
  final int pendingCount;

  /// 快照才有，標在標題上。
  final String? snapshotDate;

  /// 快照的備註，空白就不輸出。
  final String? note;

  const SettlementTextInput({
    required this.taskName,
    required this.currency,
    required this.transfers,
    required this.memberNames,
    required this.expenseCount,
    required this.total,
    this.unconvertedCount = 0,
    this.pendingCount = 0,
    this.snapshotDate,
    this.note,
  });
}

String buildSettlementText(SettlementTextInput input) {
  String name(String uid) {
    final value = input.memberNames[uid];
    return (value == null || value.isEmpty) ? _unknownMember : value;
  }

  String money(int amount) =>
      '${input.currency} ${formatAmount(amount, input.currency)}';

  final lines = <String>[];

  final date = input.snapshotDate;
  lines.add(date != null && date.isNotEmpty
      ? '${input.taskName} · 結算（$date）'
      : '${input.taskName} · 結算');

  final note = input.note?.trim();
  if (note != null && note.isNotEmpty) lines.add(note);

  lines.add(_divider);

  if (input.transfers.isNotEmpty) {
    for (final transfer in input.transfers) {
      lines.add(
        '${name(transfer.from)} → ${name(transfer.to)}  ${money(transfer.amount)}',
      );
    }
  } else {
    lines.add(_settled);
  }

  lines.add('');
  lines.add('${input.expenseCount} 筆支出 · 共 ${money(input.total)}');

  /*
    這兩行是正確性需求，不是貼心提醒：未換算的支出根本沒進結算，總額偏低；
    待確認的付款還沒從轉帳金額扣掉。不講的話，貼進群組就是散播錯的數字。
  */
  final warnings = <String>[];
  if (input.unconvertedCount > 0) {
    warnings.add('⚠ 有 ${input.unconvertedCount} 筆支出還沒有匯率，未算入上面的金額');
  }
  if (input.pendingCount > 0) {
    warnings.add('⚠ 有 ${input.pendingCount} 筆付款等待確認，還沒從上面的金額扣除');
  }
  if (warnings.isNotEmpty) {
    lines.add('');
    lines.addAll(warnings);
  }

  return lines.join('\n');
}
