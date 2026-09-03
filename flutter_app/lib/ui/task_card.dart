import 'package:flutter/material.dart';

import '../domain/currency.dart';
import '../domain/models.dart';
import '../domain/task_status.dart';
import 'theme.dart';

/// 任務列表的一張卡。`src/components/task/TaskCard.vue` 的 Flutter 版。

const Map<TaskRole, String> _roleLabels = {
  TaskRole.owner: '擁有者',
  TaskRole.admin: '管理員',
  TaskRole.member: '成員',
};

class TaskCard extends StatelessWidget {
  final Task task;
  final TaskRole role;

  /// 我在這趟旅程分攤的金額。null 代表還沒計算 —— 列表預設不算，
  /// 那要把每個任務的支出全部載下來，是「任務數 × 支出數」的成本。
  final int? myCost;

  final VoidCallback? onTap;

  /// 封存／解除封存／刪除。null 代表這個人不能做（只有 owner 能），
  /// 那時整排按鈕都不出現。
  final VoidCallback? onArchive;
  final VoidCallback? onUnarchive;
  final VoidCallback? onDelete;

  const TaskCard({
    super.key,
    required this.task,
    required this.role,
    required this.myCost,
    this.onTap,
    this.onArchive,
    this.onUnarchive,
    this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final archived = taskStatusFrom(task.status) == TaskStatus.archived;
    final text = Theme.of(context).textTheme;

    return Opacity(
      // 封存的淡一點，但不要淡到看不清 —— 它們仍然要能查。
      opacity: archived ? 0.72 : 1,
      child: Card(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(18),
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
                          Text(task.name, style: text.titleMedium),
                          const SizedBox(height: 2),
                          Text(
                            '${task.startDate ?? '未設定'} - ${task.endDate ?? '未設定'}',
                            style: text.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    _Pill(
                      label: _roleLabels[role]!,
                      background: AppColors.primarySoft,
                      foreground: AppColors.primary,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('${task.memberCount} 位成員', style: text.bodySmall),
                    Text('${task.expenseCount} 筆支出', style: text.bodySmall),
                    // 進行中不掛標籤 —— 沒消息就是好消息，每張卡貼一個
                    // 「進行中」只是噪音。
                    if (archived)
                      _Pill(
                        label: statusLabels[TaskStatus.archived]!,
                        background: AppColors.line,
                        foreground: AppColors.muted,
                      ),
                  ],
                ),
                if (myCost != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text('我的花費　', style: text.bodySmall),
                      Text(
                        '${task.defaultCurrency} '
                        '${formatAmount(myCost!, task.defaultCurrency)}',
                        style: figure(size: 16),
                      ),
                    ],
                  ),
                ],
                // 只有 owner 拿得到這幾顆。放在卡片底部而不是右上角的
                // 選單裡，是因為手機上那種三點選單很難按中，而這些操作
                // 一輩子也按不到幾次 —— 不值得為了省一點空間讓它變難按。
                if (onArchive != null || onUnarchive != null ||
                    onDelete != null) ...[
                  const Divider(height: 24),
                  Row(
                    children: [
                      if (archived && onUnarchive != null)
                        TextButton(
                          onPressed: onUnarchive,
                          child: const Text('解除封存'),
                        )
                      else if (!archived && onArchive != null)
                        TextButton(
                          onPressed: onArchive,
                          child: const Text('封存'),
                        ),
                      const Spacer(),
                      if (onDelete != null)
                        TextButton(
                          style: TextButton.styleFrom(
                            foregroundColor: AppColors.danger,
                          ),
                          onPressed: onDelete,
                          child: const Text('刪除'),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String label;
  final Color background;
  final Color foreground;

  const _Pill({
    required this.label,
    required this.background,
    required this.foreground,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
      ),
    );
  }
}
