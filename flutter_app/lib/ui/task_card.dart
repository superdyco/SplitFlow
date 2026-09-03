import 'package:flutter/material.dart';

import '../domain/currency.dart';
import '../domain/models.dart';
import '../domain/task_status.dart';
import 'ledger.dart';
import 'theme.dart';

/// 任務列表的一列。`src/components/task/TaskCard.vue` 的 Flutter 版。
///
/// 從「一張卡」變成「一列」：三趟旅程並排三張浮起來的卡，等於同一句
/// 「這個比周圍重要」講了三次，於是一次也沒成立。

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
  /// 那時整個選單都不出現。
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

    final dates =
        '${task.startDate ?? '未設定'} – ${task.endDate ?? '未設定'}';

    /*
      角色、成員數、支出數併成一行副標，不再是藥丸。

      跟網頁版同一個理由：它們是屬性不是狀態，而橘色藥丸在這個 app 裡
      代表「可以按」。原本那顆角色藥丸還把 primary 當文字色印在 primarySoft
      上 —— 那是 3.2:1，過不了 4.5:1 的門檻。上一輪的稽核說 Flutter 沒有
      把 primary 當文字用的地方，漏掉的就是這裡。
    */
    final meta = '$dates · ${_roleLabels[role]!} · '
        '${task.memberCount} 人 · ${task.expenseCount} 筆';

    final row = LedgerRow(
      title: task.name,
      subtitle: archived
          ? '$meta · ${statusLabels[TaskStatus.archived]!}'
          : meta,
      amount: myCost == null
          ? null
          : formatAmount(myCost!, task.defaultCurrency),
      amountNote: myCost == null ? null : task.defaultCurrency,
      trailing: _menu(archived),
      onTap: onTap,
    );

    // 封存的淡一點，但不要淡到看不清 —— 它們仍然要能查。
    return archived ? Opacity(opacity: 0.72, child: row) : row;
  }

  /// 只有 owner 拿得到這個選單。
  ///
  /// 原本這幾顆是卡片底部的一整排 TextButton，理由寫的是「三點選單很難按中」。
  /// 那個顧慮是對的，但它的前提是卡片 —— 一列裡放不下兩顆文字按鈕，而且列
  /// 現在整列可以點進任務頁，按鈕疊在上面就是跟它搶同一塊像素。
  ///
  /// 所以改成選單，但把命中區撐到 44×44，讓「很難按中」不再成立。
  Widget? _menu(bool archived) {
    if (onArchive == null && onUnarchive == null && onDelete == null) {
      return null;
    }

    return PopupMenuButton<VoidCallback>(
      icon: const Icon(Icons.more_vert, size: 20, color: AppColors.muted),
      // 預設的命中區比圖示大不了多少，這是上面那段註解的重點。
      constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
      padding: EdgeInsets.zero,
      splashRadius: 22,
      tooltip: '任務選項',
      onSelected: (action) => action(),
      itemBuilder: (context) => [
        if (archived && onUnarchive != null)
          PopupMenuItem(value: onUnarchive, child: const Text('解除封存'))
        else if (!archived && onArchive != null)
          PopupMenuItem(value: onArchive, child: const Text('封存')),
        // 網頁版的封存卡是不給刪除鈕的（先解除封存才能刪），Flutter 這邊
        // 一直都給。那是行為差異不是視覺差異，這一輪不動它。
        if (onDelete != null)
          PopupMenuItem(
            value: onDelete,
            child: const Text('刪除', style: TextStyle(color: AppColors.danger)),
          ),
      ],
    );
  }
}
