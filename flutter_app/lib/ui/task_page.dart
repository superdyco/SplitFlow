import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/expense_groups.dart';
import '../domain/models.dart';

import '../domain/task_status.dart';
import '../state/providers.dart';
import 'expense_day_group.dart';
import 'expense_form_page.dart';
import 'expense_row.dart';
import 'invite_sheet.dart';
import 'members_tab.dart';
import 'settlement_tab.dart';
import 'theme.dart';

/// 任務詳情。`src/pages/TaskPage.vue` 的 Flutter 版。
///
/// 三個分頁：支出、成員、結算。封存的任務唯讀 —— Firestore rules 已經擋死，
/// 這裡收起寫入入口只是不要讓人按了才失敗。
///
/// 報告與分享那一整區**不搬**（見 README 的範圍決定），那些留在網頁版。
class TaskPage extends ConsumerStatefulWidget {
  final String taskId;

  const TaskPage({super.key, required this.taskId});

  @override
  ConsumerState<TaskPage> createState() => _TaskPageState();
}

class _TaskPageState extends ConsumerState<TaskPage> {
  /// 記「收合了哪幾天」而不是「展開了哪幾天」，這樣預設全展開，
  /// 新的一天出現時也會是展開的，不用另外處理。
  final Set<String> _collapsed = {};

  Future<void> _reload() async {
    ref.invalidate(taskProvider(widget.taskId));
    ref.invalidate(expensesProvider(widget.taskId));
    ref.invalidate(membersProvider(widget.taskId));
    ref.invalidate(paymentsProvider(widget.taskId));
    await ref.read(taskProvider(widget.taskId).future);
  }

  @override
  Widget build(BuildContext context) {
    final task = ref.watch(taskProvider(widget.taskId));

    return task.when(
      loading: () => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (err, _) => Scaffold(
        appBar: AppBar(),
        body: _Centered('讀取任務失敗：$err'),
      ),
      data: (value) {
        if (value == null) return _missing('找不到這個分帳任務');

        final status = taskStatusFrom(value.status);
        // 軟刪除只是一個欄位，規則仍允許成員讀取，所以要自己擋掉這個幽靈任務。
        if (status == TaskStatus.deleted) return _missing('這個任務已被刪除。');

        return _Loaded(
          task: value,
          archived: status == TaskStatus.archived,
          collapsed: _collapsed,
          onToggleDay: (date) => setState(() {
            _collapsed.contains(date)
                ? _collapsed.remove(date)
                : _collapsed.add(date);
          }),
          onReload: _reload,
        );
      },
    );
  }

  Widget _missing(String message) =>
      Scaffold(appBar: AppBar(), body: _Centered(message));
}

class _Loaded extends ConsumerWidget {
  final Task task;
  final bool archived;
  final Set<String> collapsed;
  final void Function(String date) onToggleDay;
  final Future<void> Function() onReload;

  const _Loaded({
    required this.task,
    required this.archived,
    required this.collapsed,
    required this.onToggleDay,
    required this.onReload,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final uid = ref.watch(authStateProvider).value?.uid ?? '';
    // 跟網頁版同一個條件：管理員，而且沒封存。
    final canInvite =
        (task.ownerId == uid || task.adminIds.contains(uid)) && !archived;

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          // 點標題重新載入。網頁版加這個是因為進到任務頁之後沒有任何地方
          // 可以重讀 —— 別人剛加了一筆支出就只能整頁重整。
          title: InkWell(
            onTap: onReload,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(task.name, style: text.titleMedium),
                Text(
                  '${task.defaultCurrency} · ${task.memberCount} 位成員 · '
                  '${task.expenseCount} 筆支出',
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
          actions: [
            // 邀請連結原本只有「剛建立任務」那一頁看得到，離開之後手機上
            // 就再也拿不到 —— 旅途中臨時多一個人要加入，只能去開瀏覽器。
            if (canInvite)
              TextButton(
                onPressed: () => showInviteSheet(
                  context,
                  taskName: task.name,
                  inviteCode: task.inviteCode,
                ),
                child: const Text('邀請'),
              ),
          ],
          bottom: const TabBar(
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.muted,
            indicatorColor: AppColors.primary,
            tabs: [
              Tab(text: '支出'),
              Tab(text: '成員'),
              Tab(text: '結算'),
            ],
          ),
        ),
        body: Column(
          children: [
            if (archived)
              Container(
                width: double.infinity,
                color: AppColors.line,
                padding: const EdgeInsets.all(12),
                child: Text(
                  '這個任務已封存，目前唯讀。到「我的分帳」解除封存後才能繼續記帳。',
                  style: text.bodySmall,
                ),
              ),
            Expanded(
              child: TabBarView(
                children: [
                  _ExpensesTab(
                    task: task,
                    archived: archived,
                    collapsed: collapsed,
                    onToggleDay: onToggleDay,
                  ),
                  MembersTab(task: task, archived: archived),
                  SettlementTab(task: task, archived: archived),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- 支出

class _ExpensesTab extends ConsumerWidget {
  final Task task;
  final bool archived;
  final Set<String> collapsed;
  final void Function(String date) onToggleDay;

  const _ExpensesTab({
    required this.task,
    required this.archived,
    required this.collapsed,
    required this.onToggleDay,
  });

  /// 開新增或編輯表單。存完之後把這個任務相關的東西全部作廢重讀 ——
  /// 支出列表、結算、任務本身的 expenseCount 都變了。
  Future<void> _openForm(
    BuildContext context,
    WidgetRef ref, {
    Expense? existing,
  }) async {
    final saved = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(
        builder: (_) => ExpenseFormPage(taskId: task.id, existing: existing),
      ),
    );
    if (saved == null) return;
    ref.invalidate(expensesProvider(task.id));
    ref.invalidate(taskProvider(task.id));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final expenses = ref.watch(expensesProvider(task.id));
    final members = ref.watch(membersProvider(task.id));

    return Scaffold(
      backgroundColor: Colors.transparent,
      // 封存的任務唯讀，收起新增入口 —— rules 也擋著，這裡只是不要讓人
      // 按了才失敗。
      floatingActionButton: archived
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _openForm(context, ref),
              icon: const Icon(Icons.add),
              label: const Text('新增支出'),
            ),
      body: expenses.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _Centered('讀取支出失敗：$err'),
        data: (list) {
          if (list.isEmpty) return const _Centered('這個任務還沒有支出。');

          final names = {
            for (final m in members.value ?? const <TaskMember>[])
              m.uid: m.nickname,
          };
          final groups = groupExpensesByDate(list, task.defaultCurrency);

          return ListView(
            // 底部留白給浮動按鈕，不然最後一筆會被蓋住。
            padding: const EdgeInsets.only(bottom: 88),
            children: [
              for (final group in groups)
                ExpenseDayGroup(
                  group: group,
                  currency: task.defaultCurrency,
                  open: !collapsed.contains(group.date),
                  onToggle: () => onToggleDay(group.date),
                  children: [
                    for (final expense in group.expenses)
                      ExpenseRow(
                        expense: expense,
                        memberNames: names,
                        baseCurrency: task.defaultCurrency,
                        onTap: archived
                            ? null
                            : () => _openForm(context, ref, existing: expense),
                      ),
                  ],
                ),
            ],
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------- 小元件

class _Centered extends StatelessWidget {
  final String text;
  const _Centered(this.text);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(text, textAlign: TextAlign.center),
      ),
    );
  }
}
