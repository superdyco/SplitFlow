import 'package:flutter/material.dart';

import '../domain/currency.dart';
import '../domain/expense_groups.dart';
import 'theme.dart';

/// 支出按日期收合的一組。`src/components/expense/ExpenseDayGroup.vue` 的
/// Flutter 版。
///
/// 四十筆帳排成一長串很難找東西，分組之後「那筆晚餐在哪」從捲四十筆
/// 變成點一天。
class ExpenseDayGroup extends StatelessWidget {
  final ExpenseGroup group;
  final String currency;
  final bool open;
  final VoidCallback onToggle;
  final List<Widget> children;

  const ExpenseDayGroup({
    super.key,
    required this.group,
    required this.currency,
    required this.open,
    required this.onToggle,
    required this.children,
  });

  /// 標題只給月/日與星期，年份在任務層級就知道了。
  String get _label {
    final parts = group.date.split('-');
    if (parts.length != 3) return group.date.isEmpty ? '沒有日期' : group.date;
    final year = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    final day = int.tryParse(parts[2]);
    if (year == null || month == null || day == null) return group.date;

    // DateTime.weekday 是 1=週一…7=週日，字串要對應著排。
    const names = ['一', '二', '三', '四', '五', '六', '日'];
    final weekday = names[DateTime(year, month, day).weekday - 1];
    return '$month/$day（$weekday）';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: onToggle,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Icon(
                  open ? Icons.expand_more : Icons.chevron_right,
                  size: 20,
                  color: AppColors.muted,
                ),
                const SizedBox(width: 6),
                Text(_label,
                    style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                Text(
                  '${group.count} 筆 · ${formatAmount(group.total, currency)}',
                  style: text.bodySmall,
                ),
                // 當天有缺匯率的支出時要標出來 —— 那幾筆沒被算進小計。
                if (group.hasUnconverted)
                  Text(' ·未換算',
                      style: text.bodySmall?.copyWith(color: AppColors.danger)),
              ],
            ),
          ),
        ),
        if (open) ...children,
        const Divider(height: 1, color: AppColors.line),
      ],
    );
  }
}
