import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/expense_actions.dart';
import '../domain/expense_groups.dart';
import '../domain/expense_markers.dart';
import '../domain/member_name.dart';
import '../domain/models.dart';

import '../domain/task_status.dart';
import '../state/providers.dart';
import 'expense_day_group.dart';
import 'expense_detail_page.dart';
import 'expense_form_page.dart';
import 'expense_row.dart';
import 'invite_sheet.dart';
import 'members_tab.dart';
import 'place_map.dart';
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

  @override
  void initState() {
    super.initState();
    // 不 await —— 問權限不該擋住任務載入，而且對話框是系統畫的，
    // 跟這一頁的 build 沒有先後關係。
    _askPushPermissionOnce();
  }

  /// 第一次進任務時問一次通知權限，問過就不再問。
  ///
  /// 不在開 App 當下問是因為那時使用者還不知道這 App 要幹嘛，直接按拒絕的
  /// 機率很高 —— 而 Android 拒絕兩次之後就再也不會跳系統對話框。走到這一頁
  /// 代表他已經在跟人分帳了，「有人記帳要不要通知你」是個看得懂的問題。
  Future<void> _askPushPermissionOnce() async {
    final uid = ref.read(authStateProvider).value?.uid;
    if (uid == null) return;

    final push = ref.read(pushRepositoryProvider);

    // 已經給過權限的人不必再問，但**還是要註冊 token** —— 換裝置、重灌、
    // 或 token 輪替時它會變，而那些情況都不會再跳一次對話框。
    if (await push.hasPermission()) {
      await push.registerToken(uid);
      return;
    }

    // prefs 讀不到就當作沒問過。多問一次比永遠不問好 —— 系統那邊本來就
    // 只會跳兩次。
    SharedPreferences? prefs;
    try {
      prefs = await SharedPreferences.getInstance();
      if (prefs.getBool('asked_push_permission') == true) return;
    } catch (_) {
      prefs = null;
    }
    await prefs?.setBool('asked_push_permission', true);

    if (!await push.requestPermission()) return;
    await push.registerToken(uid);
  }

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

/// 支出頁籤的兩種看法。地圖是同一批支出的另一種排法，不是另一份資料。
enum _ExpenseView { list, map }

class _ExpensesTab extends ConsumerStatefulWidget {
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

  @override
  ConsumerState<_ExpensesTab> createState() => _ExpensesTabState();
}

class _ExpensesTabState extends ConsumerState<_ExpensesTab> {
  _ExpenseView _view = _ExpenseView.list;

  Task get task => widget.task;
  bool get archived => widget.archived;

  /// 開新增或編輯表單。存完之後把這個任務相關的東西全部作廢重讀 ——
  /// 支出列表、結算、任務本身的 expenseCount 都變了。
  Future<void> _openForm(
    BuildContext context, {
    Expense? existing,
    RepeatFields? repeat,
  }) async {
    final saved = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(
        builder: (_) => ExpenseFormPage(
          taskId: task.id,
          existing: existing,
          repeat: repeat,
        ),
      ),
    );
    if (saved == null) return;
    ref.invalidate(expensesProvider(task.id));
    ref.invalidate(taskProvider(task.id));
  }

  /// 唯讀的詳情頁。純顯示，不會改到任何東西，回來不用重讀。
  void _openDetail(
    BuildContext context,
    Expense expense,
    Map<String, String> names,
  ) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ExpenseDetailPage(
          expense: expense,
          memberNames: names,
          baseCurrency: task.defaultCurrency,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final expenses = ref.watch(expensesProvider(task.id));
    final members = ref.watch(membersProvider(task.id));

    return Scaffold(
      backgroundColor: Colors.transparent,
      // 封存的任務唯讀，收起新增入口 —— rules 也擋著，這裡只是不要讓人
      // 按了才失敗。
      floatingActionButton: archived
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _openForm(context),
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
              m.uid: memberDisplayName(m),
          };
          final groups = groupExpensesByDate(list, task.defaultCurrency);

          final uid = ref.watch(authStateProvider).value?.uid ?? '';
          final isAdmin = task.ownerId == uid || task.adminIds.contains(uid);

          final markers = expenseMarkers(list);
          // 沒有金鑰就畫不出地圖，一筆有座標的支出都沒有就沒東西可畫 ——
          // 兩種情況都不要給切換鍵，按下去只會看到空白。
          final mappable = PlaceMap.enabled && markers.isNotEmpty;
          // 停在地圖檢視時把最後一筆有座標的支出刪掉，就落回清單。
          final showMap = mappable && _view == _ExpenseView.map;

          final body = showMap
              ? _MapView(markers: markers)
              : _list(context, groups, names, uid, isAdmin);

          if (!mappable) return body;

          return Column(
            children: [
              _ViewToggle(
                view: _view,
                mapCount: markers.length,
                onChanged: (view) => setState(() => _view = view),
              ),
              Expanded(child: body),
            ],
          );
        },
      ),
    );
  }

  /// 一天一組的支出清單。
  Widget _list(
    BuildContext context,
    List<ExpenseGroup> groups,
    Map<String, String> names,
    String uid,
    bool isAdmin,
  ) {
    return ListView(
      // 底部留白給浮動按鈕，不然最後一筆會被蓋住。
      padding: const EdgeInsets.only(bottom: 88),
      children: [
        for (final group in groups)
          ExpenseDayGroup(
            group: group,
            currency: task.defaultCurrency,
            open: !widget.collapsed.contains(group.date),
            onToggle: () => widget.onToggleDay(group.date),
            children: [
              ...group.expenses.map((expense) {
                // 每個人都點得進去，差別只在點到哪：管得動的進編輯頁，
                // 其他人進唯讀的詳情頁。封存之後誰都管不動，於是整份
                // 帳變成大家都讀得到 —— 那正是要翻帳的時候。
                final manageable = canManageExpense(
                  expense: expense,
                  uid: uid,
                  isAdmin: isAdmin,
                  archived: archived,
                );

                return ExpenseRow(
                  expense: expense,
                  memberNames: names,
                  baseCurrency: task.defaultCurrency,
                  onTap: manageable
                      ? () => _openForm(context, existing: expense)
                      : () => _openDetail(context, expense, names),
                  // 「再記一筆」是新增，不是修改 —— 管不動這一筆的人
                  // 照樣做得到，只有封存的任務不行。
                  onRepeat: archived
                      ? null
                      : () => _openForm(
                            context,
                            repeat: repeatFieldsOf(expense),
                          ),
                );
              }),
            ],
          ),
      ],
    );
  }
}

/// 清單／地圖切換。網頁版是兩顆 tab，這裡用 Material 的分段按鈕 ——
/// 上面已經有一排真的頁籤了，再放一排長得一樣的會分不出哪一排在切什麼。
class _ViewToggle extends StatelessWidget {
  final _ExpenseView view;

  /// 地圖上有幾個標記。**跟支出筆數不一樣**，所以要標出來 ——
  /// 不然使用者會以為地圖漏掉了幾筆。
  final int mapCount;

  final void Function(_ExpenseView view) onChanged;

  const _ViewToggle({
    required this.view,
    required this.mapCount,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: SizedBox(
        width: double.infinity,
        child: SegmentedButton<_ExpenseView>(
          segments: [
            const ButtonSegment(
              value: _ExpenseView.list,
              label: Text('清單'),
              icon: Icon(Icons.list),
            ),
            ButtonSegment(
              value: _ExpenseView.map,
              label: Text('地圖（$mapCount）'),
              icon: const Icon(Icons.map_outlined),
            ),
          ],
          selected: {view},
          showSelectedIcon: false,
          onSelectionChanged: (selected) => onChanged(selected.first),
        ),
      ),
    );
  }
}

/// 整趟旅程的支出標在同一張圖上。
class _MapView extends StatelessWidget {
  final List<MapMarker> markers;

  const _MapView({required this.markers});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Padding(
      // 底部一樣留白給浮動按鈕。
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 撐滿剩下的空間：這張圖是要看相對位置的，180px 看不出來。
          Expanded(child: PlaceMap(markers: markers, height: null)),
          const SizedBox(height: 8),
          Text(
            '只顯示有座標的支出。從地點搜尋清單選出來的才有座標，自己打字的沒有。',
            style: text.bodySmall,
          ),
        ],
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
