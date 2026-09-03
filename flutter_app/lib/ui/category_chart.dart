import 'package:flutter/material.dart';

import '../domain/category_totals.dart';
import '../domain/currency.dart';
import '../domain/models.dart';
import 'theme.dart';

/// 各分類支出。`src/components/settlement/CategoryChart.vue` 的 Flutter 版。
///
/// 網頁版用 Chart.js 畫水平長條，這裡用一排 `FractionallySizedBox`。
/// 為了一張長條圖多背一個繪圖套件不划算 —— 而且少了那層之後，
/// 圖表不會有「載入失敗」這種狀態，網頁版還得為此準備一句提示。
///
/// **金額才是主角，長條只是讓比例一眼看得出來。** 所以數字一律照實寫出來，
/// 不靠長度去讀。
class CategoryChart extends StatelessWidget {
  final List<Expense> expenses;
  final String currency;

  const CategoryChart({
    super.key,
    required this.expenses,
    required this.currency,
  });

  @override
  Widget build(BuildContext context) {
    final rows = categoryTotals(expenses, currency);
    // 全部都沒有匯率、或根本沒有支出時就不佔位子。
    if (rows.isEmpty) return const SizedBox.shrink();

    final text = Theme.of(context).textTheme;
    // 最大的那一條佔滿寬度，其餘按比例 —— 用最大值而不是總和當基準，
    // 不然分類一多每條都短得看不出差別。
    final max = rows.first.total;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('各分類支出', style: text.titleMedium),
            const Spacer(),
            Text(currency, style: text.bodySmall),
          ],
        ),
        const SizedBox(height: 12),
        for (final row in rows) ...[
          _Row(row: row, currency: currency, max: max),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _Row extends StatelessWidget {
  final CategoryTotal row;
  final String currency;
  final int max;

  const _Row({required this.row, required this.currency, required this.max});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final meta = categoryMeta(row.category);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Row(
                children: [
                  Icon(meta.icon, size: 16, color: AppColors.primaryDark),
                  const SizedBox(width: AppSpace.x2),
                  Text(meta.label, style: text.bodyMedium),
                ],
              ),
            ),
            Text(
              formatAmount(row.total, currency),
              style: text.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 40,
              child: Text(
                '${row.share.round()}%',
                textAlign: TextAlign.right,
                style: text.bodySmall,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: Container(
            height: 6,
            color: AppColors.line,
            child: FractionallySizedBox(
              alignment: Alignment.centerLeft,
              // max 是這一組裡最大的那筆，必然大於 0（categoryTotals
              // 不會回傳金額為 0 的分類）。
              widthFactor: row.total / max,
              child: Container(color: AppColors.primary),
            ),
          ),
        ),
      ],
    );
  }
}
