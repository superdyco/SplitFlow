import 'package:flutter/material.dart';

import '../domain/currency.dart';
import 'theme.dart';

/// 報告裡的水平長條。`src/components/report/ReportBar.vue` 的 Flutter 版。
///
/// 兩種用途的基準不同（分類是佔總額百分比、地點是相對於最大值的比例），
/// 但都在呼叫端換算成 0-1 再傳進來 —— 這個元件不需要知道那個差別。
class ReportBar extends StatelessWidget {
  /// 0-1。超出範圍會被夾住，資料異常時不會撐破版面。
  final double value;

  /// 地點用淡版，才不會跟分類的長條搶視覺重量。
  final bool soft;

  const ReportBar({super.key, required this.value, this.soft = false});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: LinearProgressIndicator(
        value: value.clamp(0, 1),
        minHeight: 6,
        backgroundColor: AppColors.line,
        // 用透明度而不是 primarySoft：後者是給卡片底色用的，
        // 當長條會淡到看不出長度。
        valueColor: AlwaysStoppedAnimation(
          soft ? AppColors.primary.withValues(alpha: 0.35) : AppColors.primary,
        ),
      ),
    );
  }
}

/// 一份旅費報告在清單裡的樣子。探索頁與收藏頁共用。
/// `src/components/report/ReportCard.vue` 的 Flutter 版。
///
/// 兩邊的資料來源不同（一個是報告文件、一個是收藏的快照），所以這裡只收
/// 攤平後的顯示欄位，不收整份 report 物件 —— 收整份的話這個元件就得認得
/// 兩種形狀，而它們遲早會分岔。
class ReportCard extends StatelessWidget {
  final String taskName;
  final String currency;
  final String? startDate;
  final String? endDate;
  final int? days;
  final int memberCount;
  final int total;
  final VoidCallback onOpen;

  /// 右下角那顆動作鈕。探索頁是「收藏／已收藏」，收藏頁是「移除」。
  /// 塞成一堆互斥的旗標會很快變成一團，所以直接收 widget。
  final Widget? action;

  const ReportCard({
    super.key,
    required this.taskName,
    required this.currency,
    required this.startDate,
    required this.endDate,
    required this.days,
    required this.memberCount,
    required this.total,
    required this.onOpen,
    this.action,
  });

  /// 天數、人數這種一定有的先放，日期沒填就整段不出現，
  /// 不要留一個空的分隔點。
  String get _facts {
    final items = ['$memberCount 人'];
    if (days != null && days! > 0) items.add('$days 天');
    return items.join(' · ');
  }

  String get _dateRange {
    if (startDate == null || endDate == null) return '';
    return '$startDate – $endDate';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Card(
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          taskName,
                          style: text.titleMedium,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(_facts, style: text.bodySmall),
                        if (_dateRange.isNotEmpty)
                          Text(_dateRange, style: text.bodySmall),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(currency, style: text.bodySmall),
                      Text(
                        formatAmount(total, currency),
                        style: text.titleMedium?.copyWith(
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (action != null) ...[
                const SizedBox(height: 12),
                Align(alignment: Alignment.centerRight, child: action!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
