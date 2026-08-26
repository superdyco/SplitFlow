import 'package:flutter/material.dart';

import '../domain/currency.dart';
import '../domain/expense_date.dart';
import '../domain/models.dart';
import 'theme.dart';

/// 支出列表的一列。`src/components/expense/ExpenseRow.vue` 的 Flutter 版。

const Map<ExpenseCategory, String> _icons = {
  ExpenseCategory.food: '🍽',
  ExpenseCategory.transport: '🚗',
  ExpenseCategory.stay: '🏨',
  ExpenseCategory.ticket: '🎟',
  ExpenseCategory.shopping: '🛍',
  ExpenseCategory.other: '📦',
};

class ExpenseRow extends StatelessWidget {
  final Expense expense;
  final Map<String, String> memberNames;
  final String baseCurrency;
  final VoidCallback? onTap;

  const ExpenseRow({
    super.key,
    required this.expense,
    required this.memberNames,
    required this.baseCurrency,
    this.onTap,
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
            Text(_icons[expense.category] ?? '📦',
                style: const TextStyle(fontSize: 20)),
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
                  Text('$_shown · $paidBy 付 · $splitLabel',
                      style: text.bodySmall),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${expense.currency} '
                  '${formatAmount(expense.amount, expense.currency)}',
                  style: text.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (converted != null)
                  Text('≈ $baseCurrency $converted', style: text.bodySmall),
                // 缺匯率的要講出來 —— 它沒被算進任何一個總額，
                // 不講的話使用者只會看到數字對不上而不知道為什麼。
                if (missingRate)
                  Text('未換算',
                      style: text.bodySmall?.copyWith(color: AppColors.danger)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
