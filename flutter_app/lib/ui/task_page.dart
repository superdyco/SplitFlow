import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/currency.dart';
import '../domain/expense_groups.dart';
import '../domain/models.dart';

import '../domain/settlement_text.dart';
import '../domain/task_status.dart';
import '../state/providers.dart';
import 'expense_day_group.dart';
import 'expense_form_page.dart';
import 'expense_row.dart';
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
                  _MembersTab(taskId: task.id),
                  _SettlementTab(task: task),
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

// ---------------------------------------------------------------- 成員

class _MembersTab extends ConsumerWidget {
  final String taskId;

  const _MembersTab({required this.taskId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final members = ref.watch(membersProvider(taskId));
    final text = Theme.of(context).textTheme;

    return members.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _Centered('讀取成員失敗：$err'),
      data: (list) => ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          for (final member in list)
            ListTile(
              // 被移除的人仍然列出來 —— 既有支出還掛著他的名字，
              // 從清單裡消失只會讓人以為那些帳算錯了。
              leading: CircleAvatar(
                backgroundColor:
                    member.active ? AppColors.primarySoft : AppColors.line,
                child: Text(
                  member.nickname.isEmpty
                      ? '?'
                      : member.nickname.characters.first,
                  style: TextStyle(
                    color: member.active ? AppColors.primary : AppColors.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              title: Text(
                member.nickname.isEmpty ? '（沒有暱稱）' : member.nickname,
                style: text.bodyMedium?.copyWith(
                  color: member.active ? AppColors.ink : AppColors.muted,
                ),
              ),
              subtitle: Text(
                member.active ? _roleLabel(member.role) : '已移除',
                style: text.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  String _roleLabel(String role) => switch (role) {
        'owner' => '擁有者',
        'admin' => '管理員',
        _ => '成員',
      };
}

// ---------------------------------------------------------------- 結算

class _SettlementTab extends ConsumerWidget {
  final Task task;

  const _SettlementTab({required this.task});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settlement = ref.watch(settlementProvider(task.id));
    final members = ref.watch(membersProvider(task.id));
    final payments = ref.watch(paymentsProvider(task.id));
    final text = Theme.of(context).textTheme;

    return settlement.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _Centered('算不出結算：$err'),
      data: (result) {
        final names = {
          for (final m in members.value ?? const <TaskMember>[])
            m.uid: m.nickname,
        };
        final pending = (payments.value ?? const <Payment>[])
            .where((p) => p.status != 'confirmed')
            .length;

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('總花費', style: text.bodySmall),
                    Text(
                      '${result.currency} '
                      '${formatAmount(result.total, result.currency)}',
                      style: figureStyle,
                    ),
                    const SizedBox(height: 4),
                    Text('列入 ${result.expenseCount} 筆支出',
                        style: text.bodySmall),
                  ],
                ),
              ),
            ),

            // 這兩個警告是正確性需求，不是貼心提醒：未換算的支出根本沒進
            // 結算，總額偏低；待確認的付款還沒從轉帳金額扣掉。
            if (result.unconverted.isNotEmpty)
              _Warning('有 ${result.unconverted.length} 筆支出還沒有匯率，未算入上面的金額'),
            if (pending > 0) _Warning('有 $pending 筆付款等待確認，還沒從下面的金額扣除'),

            const SizedBox(height: 20),
            Text('誰欠誰', style: text.titleMedium),
            const SizedBox(height: 8),
            if (result.transfers.isEmpty)
              Text('大家都已結清，不需要轉帳。', style: text.bodyMedium)
            else
              for (final transfer in result.transfers)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${names[transfer.from] ?? '已離開的成員'} → '
                          '${names[transfer.to] ?? '已離開的成員'}',
                          style: text.bodyMedium,
                        ),
                      ),
                      Text(
                        '${result.currency} '
                        '${formatAmount(transfer.amount, result.currency)}',
                        style: text.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                ),

            const SizedBox(height: 24),
            Text('每個人的收支', style: text.titleMedium),
            const SizedBox(height: 8),
            for (final balance in result.balances)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(names[balance.uid] ?? '已離開的成員',
                          style: text.bodyMedium),
                    ),
                    Text(
                      '${balance.balance >= 0 ? '應收 ' : '應付 '}'
                      '${formatAmount(balance.balance.abs(), result.currency)}',
                      style: text.bodyMedium?.copyWith(
                        color: balance.balance >= 0
                            ? AppColors.success
                            : AppColors.danger,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
              ),

            const SizedBox(height: 24),
            OutlinedButton.icon(
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('複製結算文字'),
              onPressed: () => _copy(context, result, names, pending),
            ),
          ],
        );
      },
    );
  }

  void _copy(
    BuildContext context,
    Settlement result,
    Map<String, String> names,
    int pending,
  ) {
    final text = buildSettlementText(SettlementTextInput(
      taskName: task.name,
      currency: result.currency,
      transfers: result.transfers,
      memberNames: names,
      expenseCount: result.expenseCount,
      total: result.total,
      unconvertedCount: result.unconverted.length,
      pendingCount: pending,
    ));

    // 剪貼簿之後接，先讓內容看得到 —— 這一段的重點是文字組得對不對。
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        content: SingleChildScrollView(child: SelectableText(text)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('關閉'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- 小元件

class _Warning extends StatelessWidget {
  final String message;
  const _Warning(this.message);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('⚠ '),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );
  }
}

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
