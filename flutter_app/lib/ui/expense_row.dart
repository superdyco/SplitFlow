import 'package:flutter/material.dart';

import '../domain/currency.dart';
import '../domain/expense_date.dart';
import '../domain/models.dart';
import 'theme.dart';

/// 支出列表的一列。`src/components/expense/ExpenseRow.vue` 的 Flutter 版。

class ExpenseRow extends StatelessWidget {
  final Expense expense;
  final Map<String, String> memberNames;
  final String baseCurrency;
  final VoidCallback? onTap;

  /// 拿這一筆當範本再記一筆。null 就不顯示按鈕（封存的任務）。
  final VoidCallback? onRepeat;

  const ExpenseRow({
    super.key,
    required this.expense,
    required this.memberNames,
    required this.baseCurrency,
    this.onTap,
    this.onRepeat,
  });

  /// 只顯示月/日，年份在任務層級就知道了，列表裡每筆都印年份太吵。
  /// 有記時間就接在後面（`03/05 19:30`），沒記就只有日期。
  String get _shown {
    final date = expenseDate(expense);
    final short =
        date.length >= 10 ? date.substring(5).replaceAll('-', '/') : date;
    final time = expenseTime(expense);
    return time.isEmpty ? short : '$short $time';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final paidBy = memberNames[expense.paidBy] ?? '已離開的成員';
    final place = expense.place;
    final splitCount = expense.splits.length;
    final splitLabel = expense.splitMode == SplitMode.custom
        ? '$splitCount 人自訂'
        : '$splitCount 人均分';

    // 外幣才需要顯示換算後金額，同幣別顯示原金額就夠了。
    final foreign = expense.currency != baseCurrency;
    final converted = foreign && expense.baseAmount != null
        ? formatAmount(expense.baseAmount!, baseCurrency)
        : null;
    final missingRate = foreign && expense.baseAmount == null;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              categoryMeta(expense.category).icon,
              size: 18,
              color: AppColors.primaryDark,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    expense.title,
                    style:
                        text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          '$_shown · $paidBy 付 · $splitLabel',
                          style: text.bodySmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      // 有收據要看得出來，不然只能一筆一筆點進去找。
                      if (expense.receipt != null) ...[
                        const SizedBox(width: AppSpace.x1),
                        const Icon(
                          Icons.attach_file,
                          size: 13,
                          color: AppColors.muted,
                        ),
                      ],
                    ],
                  ),
                  // 地點與備註在列表就要看得到。要點進去才看得到的話，
                  // 對帳時每一筆都得點一次 —— 那兩個欄位就等於白填。
                  // 各自截成一行：它們是掃過去用的線索，不是內文。
                  //
                  // 圖示而不是 emoji：跟分類同一個理由，emoji 在不同 ROM 上
                  // 長得不一樣，而且吃不到 muted 這個顏色。
                  if (place != null)
                    _Clue(icon: Icons.place_outlined, label: place.name),
                  if (expense.note.isNotEmpty)
                    _Clue(icon: Icons.notes, label: expense.note),
                  if (onRepeat != null) ...[
                    const SizedBox(height: 6),
                    // 巢狀按鈕自己會吃掉點擊，不用像網頁版那樣擋冒泡。
                    _RepeatButton(onPressed: onRepeat!),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            // 固定欄寬，不是讓它自己撐 —— 名稱長的那幾列會把金額往右推，
            // 一整欄看下來就是歪的。
            SizedBox(
              width: 84,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    formatAmount(expense.amount, expense.currency),
                    textAlign: TextAlign.right,
                    style: figure(size: 15, weight: FontWeight.w600),
                  ),
                  // 幣別小一級：一整欄的「THB 1,250」同字級的話，每一列都要
                  // 先跳過三個字母才讀得到數字。
                  Text(
                    expense.currency,
                    textAlign: TextAlign.right,
                    style: text.bodySmall,
                  ),
                  if (converted != null)
                    Text(
                      '≈ $baseCurrency $converted',
                      textAlign: TextAlign.right,
                      style: text.bodySmall,
                    ),
                  // 缺匯率的要講出來 —— 它沒被算進任何一個總額，
                  // 不講的話使用者只會看到數字對不上而不知道為什麼。
                  if (missingRate)
                    Text(
                      '未換算',
                      textAlign: TextAlign.right,
                      style: text.bodySmall?.copyWith(color: AppColors.danger),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 列表上的一條線索：地點或備註。圖示加一行截斷的文字。
class _Clue extends StatelessWidget {
  final IconData icon;
  final String label;

  const _Clue({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Row(
      children: [
        Icon(icon, size: 13, color: AppColors.muted),
        const SizedBox(width: AppSpace.x1),
        Flexible(
          child: Text(
            label,
            style: text.bodySmall,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// 旅行支出重複性很高（每天的交通、便利商店、同一間餐廳），每次從頭填很煩。
/// 帶走什麼、刻意不帶什麼見 `repeatFieldsOf`。
class _RepeatButton extends StatelessWidget {
  final VoidCallback onPressed;

  const _RepeatButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 28,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          foregroundColor: AppColors.muted,
          side: const BorderSide(color: AppColors.lineStrong),
          shape: const StadiumBorder(),
          textStyle: Theme.of(context).textTheme.bodySmall,
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        child: const Text('再記一筆'),
      ),
    );
  }
}
