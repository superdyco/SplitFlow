import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/currency.dart';
import '../domain/models.dart';
import '../domain/my_cost.dart';
import '../domain/offline_write.dart';
import '../domain/task_actions.dart';
import '../domain/task_status.dart';
import '../state/pending_invite.dart';
import '../state/pending_task.dart';
import '../state/providers.dart';
import 'create_task_page.dart';
import 'join_task_page.dart';
import 'profile_page.dart';
import 'confirm_dialog.dart';
import 'task_card.dart';
import 'task_page.dart';
import 'theme.dart';

/// 我的分帳。`src/pages/TaskListPage.vue` 的 Flutter 版。
///
/// 「計算我的花費」照網頁版做成**按需載入**：換算後的分攤金額沒有存在資料庫
/// 裡，沒辦法用聚合查詢在伺服器端加總（跨幣別會算錯），只能把每個任務的支出
/// 全部載下來在前端算。不點就維持列表原本的速度，點了才付
/// 「任務數 × 支出數」這個成本。
class TaskListPage extends ConsumerStatefulWidget {
  const TaskListPage({super.key});

  @override
  ConsumerState<TaskListPage> createState() => _TaskListPageState();
}

class _TaskListPageState extends ConsumerState<TaskListPage> {
  Map<String, int>? _costs;
  bool _costsBusy = false;
  String? _costsError;

  @override
  void initState() {
    super.initState();
    // 走到這一頁代表登入狀態已經確定了，這時導頁才安全。
    // 用 addPostFrameCallback 是因為 initState 當下還不能 push。
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // 使用者主動點的邀請優先於先前殘留的通知導頁。
      if (!_consumePendingInvite()) _consumePendingTask();
    });
  }

  /// 點 Universal Link / App Link 帶進來的邀請，登入與暱稱都完成後才開。
  bool _consumePendingInvite() {
    final inviteCode = ref.read(pendingInviteCodeProvider);
    if (inviteCode == null || !mounted) return false;

    ref.read(pendingInviteCodeProvider.notifier).state = null;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => JoinTaskPage(inviteCode: inviteCode),
      ),
    );
    return true;
  }

  /// 點通知帶進來的任務，開一次就消費掉。
  void _consumePendingTask() {
    final taskId = ref.read(pendingTaskIdProvider);
    if (taskId == null || !mounted) return;

    ref.read(pendingTaskIdProvider.notifier).state = null;
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => TaskPage(taskId: taskId)),
    );
  }

  /// 點卡片進任務頁。
  ///
  /// 回來之後把這個任務的資料作廢重讀 —— 在裡面新增或刪了支出的話，
  /// 列表上的筆數與「我的花費」都過期了。不重讀的話使用者會看到舊數字，
  /// 而且不知道為什麼。
  Future<void> _openTask(Task task) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => TaskPage(taskId: task.id)),
    );
    if (!mounted) return;
    ref.invalidate(tasksProvider);
    // 花費是手動算的，回來之後那份快照可能也過期了，收起來重算比顯示錯的好。
    setState(() => _costs = null);
  }

  Future<void> _loadCosts(List<Task> tasks) async {
    final uid = ref.read(authStateProvider).value?.uid;
    if (uid == null) return;

    setState(() {
      _costsBusy = true;
      _costsError = null;
    });

    try {
      final expenses = ref.read(expenseRepositoryProvider);
      final repo = ref.read(taskRepositoryProvider);
      final result = <String, int>{};

      for (final task in tasks) {
        // 成員也要載：餘數分給誰取決於加入順序，少了它數字會跟結算頁差幾分錢。
        final list = await expenses.listExpenses(task.id);
        final order = await repo.memberOrder(task.id);
        result[task.id] = myTripCost(list, order, uid, task.defaultCurrency);
      }

      if (mounted) setState(() => _costs = result);
    } catch (err) {
      if (mounted) setState(() => _costsError = err.toString());
    } finally {
      if (mounted) setState(() => _costsBusy = false);
    }
  }

  /// 封存／解除封存／刪除。
  ///
  /// 不做樂觀更新：失敗時要把卡片放回原狀，多一組狀態換一點點速度，
  /// 而這個操作一輩子按不到幾次。網頁版的取捨一樣。
  Future<void> _changeStatus(Task task, TaskStatus next) async {
    final prompt = taskActionPrompt(task, next);
    final ok = await showConfirmDialog(
      context,
      title: prompt.title,
      message: prompt.message,
      confirmLabel: prompt.confirmLabel,
      requireText: prompt.requireText,
      destructive: prompt.destructive,
    );
    if (!ok || !mounted) return;

    try {
      await settleWrite(
        ref.read(taskRepositoryProvider).setTaskStatus(task.id, next.name),
      );
      if (!mounted) return;
      ref.invalidate(tasksProvider);
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('沒有成功：$err')),
      );
    }
  }

  /// 這張卡要不要給那幾顆按鈕。
  ///
  /// 只有 owner 能封存與刪除 —— firestore.rules 也擋著，這裡收起來只是
  /// 不要讓人按了才失敗。
  TaskCard _card(Task task, String uid) {
    final manageable = canChangeTaskStatus(task, uid);
    return TaskCard(
      task: task,
      role: taskRole(
        ownerId: task.ownerId,
        adminIds: task.adminIds,
        uid: uid,
      ),
      myCost: _costs?[task.id],
      onTap: () => _openTask(task),
      onArchive: manageable
          ? () => _changeStatus(task, TaskStatus.archived)
          : null,
      onUnarchive:
          manageable ? () => _changeStatus(task, TaskStatus.active) : null,
      onDelete:
          manageable ? () => _changeStatus(task, TaskStatus.deleted) : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    // App 已經停在任務列表上時收到點擊，走的是這條 —— initState 那次
    // 早就跑完了。
    ref.listen<String?>(pendingTaskIdProvider, (_, next) {
      if (next != null) _consumePendingTask();
    });
    ref.listen<String?>(pendingInviteCodeProvider, (_, next) {
      if (next != null) _consumePendingInvite();
    });

    final tasks = ref.watch(tasksProvider);
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('我的分帳'),
        actions: [
          IconButton(
            tooltip: '個人設定',
            icon: const Icon(Icons.person_outline),
            onPressed: () async {
              await Navigator.of(context).push<void>(
                MaterialPageRoute(builder: (_) => const ProfilePage()),
              );
              // 改了暱稱之後，成員清單與結算上顯示的名字都要跟著更新。
              if (mounted) ref.invalidate(userProfileProvider);
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await Navigator.of(context).push<bool>(
            MaterialPageRoute(builder: (_) => const CreateTaskPage()),
          );
          if (created == true && mounted) ref.invalidate(tasksProvider);
        },
        icon: const Icon(Icons.add),
        label: const Text('建立'),
      ),
      body: tasks.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _Retry(
          message: '讀取任務列表失敗：$err',
          onRetry: () => ref.invalidate(tasksProvider),
        ),
        data: (all) {
          // 已刪除的一律不出現在任何一區 —— 規則在 partitionTasks 裡，有測試釘住。
          final parts = partitionTasks(all, (t) => taskStatusFrom(t.status));
          final uid = ref.watch(authStateProvider).value?.uid ?? '';

          if (parts.active.isEmpty && parts.archived.isEmpty) {
            return const _Empty();
          }

          // 封存的也要算花費。封存代表「這趟結束了，不再記帳」，不代表錢沒花過 ——
          // 而且旅程通常是走完才封存，排除掉的話總花費會少掉最完整的那幾趟。
          final costable = [...parts.active, ...parts.archived];

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(tasksProvider);
              await ref.read(tasksProvider.future);
            },
            child: ListView(
              // 底部留白給浮動按鈕，不然最後一張卡會被蓋住。
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
              children: [
                _CostSection(
                  tasks: costable,
                  costs: _costs,
                  busy: _costsBusy,
                  error: _costsError,
                  onCalculate: () => _loadCosts(costable),
                ),
                const SizedBox(height: 16),
                for (final task in parts.active) ...[
                  _card(task, uid),
                  const SizedBox(height: 12),
                ],
                if (parts.archived.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text('已封存', style: text.titleMedium),
                  const SizedBox(height: 12),
                  for (final task in parts.archived) ...[
                    _card(task, uid),
                    const SizedBox(height: 12),
                  ],
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

/// 「計算我的花費」與算完之後的各幣別總計。
class _CostSection extends StatelessWidget {
  final List<Task> tasks;
  final Map<String, int>? costs;
  final bool busy;
  final String? error;
  final VoidCallback onCalculate;

  const _CostSection({
    required this.tasks,
    required this.costs,
    required this.busy,
    required this.error,
    required this.onCalculate,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    if (costs == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OutlinedButton(
            onPressed: busy ? null : onCalculate,
            child: Text(busy ? '計算中...' : '計算我的花費'),
          ),
          if (error != null) ...[
            const SizedBox(height: 8),
            Text(error!,
                style: text.bodySmall?.copyWith(color: AppColors.danger)),
          ],
        ],
      );
    }

    // 跨旅程的總計依幣別分開列，不合併 —— 每個任務有自己的主要幣別，
    // 把 TWD 跟 THB 加在一起是錯的。
    final totals = sumByCurrency([
      for (final task in tasks)
        CurrencyAmount(task.defaultCurrency, costs![task.id] ?? 0),
    ]);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Wrap(
            spacing: 24,
            runSpacing: 10,
            children: [
              if (totals.isEmpty) Text('目前還沒有算得出金額的支出。', style: text.bodySmall),
              for (final item in totals)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.currency, style: text.bodySmall),
                    Text(
                      formatAmount(item.amount, item.currency),
                      style: figureStyle,
                    ),
                  ],
                ),
            ],
          ),
        ),
        TextButton(
          onPressed: busy ? null : onCalculate,
          child: Text(busy ? '計算中...' : '重新計算'),
        ),
      ],
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('目前沒有進行中的分帳', style: text.titleMedium),
            const SizedBox(height: 8),
            Text(
              '建立一個新任務，或從別人傳來的邀請連結加入。',
              textAlign: TextAlign.center,
              style: text.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _Retry extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _Retry({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('重試')),
          ],
        ),
      ),
    );
  }
}
