import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/member_footprint.dart';
import '../domain/member_name.dart';
import '../domain/models.dart';
import '../domain/offline_write.dart';
import '../state/providers.dart';
import 'remove_member_dialog.dart';
import 'ledger.dart';
import 'theme.dart';

/// 任務的成員分頁。`src/components/member/MemberRow.vue` 與 TaskPage 的
/// 成員區塊合起來的 Flutter 版。
///
/// 權限規則跟網頁版一致，而且**每一條 firestore.rules 也擋著** ——
/// 這裡收起按鈕只是不要讓人按了才失敗：
///
///   - 只有 owner / admin 能管理
///   - owner 不能被降級或移除
///   - 不能對自己動作
///   - 封存的任務唯讀
class MembersTab extends ConsumerStatefulWidget {
  final Task task;
  final bool archived;

  const MembersTab({super.key, required this.task, required this.archived});

  @override
  ConsumerState<MembersTab> createState() => _MembersTabState();
}

class _MembersTabState extends ConsumerState<MembersTab> {
  String? _busyUid;
  String? _error;

  final _virtualNickname = TextEditingController();
  bool _addingVirtual = false;

  @override
  void dispose() {
    _virtualNickname.dispose();
    super.dispose();
  }

  bool _isAdmin(String uid) =>
      widget.task.ownerId == uid || widget.task.adminIds.contains(uid);

  Future<void> _run(String uid, Future<void> Function() action) async {
    setState(() {
      _busyUid = uid;
      _error = null;
    });
    try {
      await settleWrite(action());
      ref.invalidate(membersProvider(widget.task.id));
      ref.invalidate(taskProvider(widget.task.id));
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busyUid = null);
    }
  }

  /// 長輩這類沒有 Google 帳號的人，由管理者代為建立。
  ///
  /// 沒有走 _run 是因為那支函式要一個 uid 來標示哪一列在忙，而這裡還沒有人
  /// 可以標 —— id 要等寫入成功才存在。
  Future<void> _addVirtual() async {
    final nickname = _virtualNickname.text.trim();
    if (nickname.isEmpty || _addingVirtual) return;

    setState(() {
      _addingVirtual = true;
      _error = null;
    });
    try {
      // settleWrite 吃的是 Future<void>，而 createVirtualMember 回傳
      // Future<String>。Dart 的 void 是 top type，可以直接傳。
      await settleWrite(ref
          .read(taskRepositoryProvider)
          .createVirtualMember(widget.task.id, nickname));
      _virtualNickname.clear();
      ref.invalidate(membersProvider(widget.task.id));
      ref.invalidate(taskProvider(widget.task.id));
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _addingVirtual = false);
    }
  }

  /// 改名只對虛擬成員開放 —— 真實成員的暱稱來自個人資料，他自己改。
  Future<void> _rename(TaskMember member) async {
    final next = await showDialog<String>(
      context: context,
      builder: (context) => _RenameDialog(initial: member.nickname),
    );

    if (next == null || next.isEmpty || next == member.nickname) return;

    await _run(
      member.uid,
      () => ref
          .read(taskRepositoryProvider)
          .renameMember(widget.task.id, member.uid, next),
    );
  }

  /// 移除成員。先算出他留下了哪些帳，再讓使用者決定要不要一起刪。
  ///
  /// 沒有帳的人不跳選擇，直接刪 —— 軟刪存在的唯一理由是「讓舊支出查得到
  /// 暱稱」，沒有舊支出就沒有這個需求。
  Future<void> _remove(TaskMember member) async {
    final expenses =
        ref.read(expensesProvider(widget.task.id)).value ?? const <Expense>[];
    final payments =
        ref.read(paymentsProvider(widget.task.id)).value ?? const <Payment>[];
    final footprint = memberFootprint(member.uid, expenses, payments);

    // **等結算算完再問**，不要用 `.value ?? 0`。
    //
    // AsyncValue 還在載入時 `.value` 是 null，跟「他不在 balances 裡」
    // 長得一樣 —— 兩者都會變成 0，於是對話框在一個不可逆的決定前面
    // 告訴使用者「他沒有欠款」，而其實有。
    //
    // 真的算不出來（離線、規則擋下）就傳 null，訊息會照實說算不出餘額。
    int? balance;
    try {
      final settlement = await ref.read(settlementProvider(widget.task.id).future);
      // 沒出現在 balances 代表他還沒參與任何一筆支出，那才真的是已結清。
      balance = settlement.balances
              .where((b) => b.uid == member.uid)
              .map((b) => b.balance)
              .firstOrNull ??
          0;
    } catch (_) {
      balance = null;
    }
    if (!mounted) return;

    final choice = await showRemoveMemberDialog(
      context,
      removeMemberPrompt(
        name: member.nickname,
        expenseCount: footprint.expenseIds.length,
        paymentCount: footprint.paymentIds.length,
        balance: balance,
        currency: widget.task.defaultCurrency,
        virtual: member.virtual,
        othersPaid: footprint.othersPaid,
      ),
    );

    if (!mounted || choice == RemoveMemberChoice.cancel) return;

    final repository = ref.read(taskRepositoryProvider);
    await _run(
      member.uid,
      () => choice == RemoveMemberChoice.soft
          ? repository.removeMember(widget.task.id, member.uid)
          : repository.hardDeleteMember(widget.task.id, member.uid, footprint),
    );

    if (choice != RemoveMemberChoice.hard) return;

    // 真實移除連支出也刪了，那兩份快取要跟著失效。
    ref.invalidate(expensesProvider(widget.task.id));
    ref.invalidate(paymentsProvider(widget.task.id));

    // 帳都刪乾淨了才清照片，best-effort —— 孤兒檔案是既有的設計取捨
    // （見網頁版 receiptService 的 deleteReceipt 註解）。失敗不該讓已經
    // 成功的刪除看起來像失敗了。
    final receipts = ref.read(receiptRepositoryProvider);
    for (final expenseId in footprint.expenseIds) {
      try {
        await receipts.delete(widget.task.id, expenseId);
      } catch (_) {
        // 檔案本來就不存在、或現在離線 —— 都不影響結果。
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final members = ref.watch(membersProvider(widget.task.id));
    final uid = ref.watch(authStateProvider).value?.uid ?? '';
    final canManage = _isAdmin(uid) && !widget.archived;
    final text = Theme.of(context).textTheme;

    return members.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text('讀取成員失敗：$err', textAlign: TextAlign.center),
        ),
      ),
      data: (list) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ...[
            Text(_error!,
                style: text.bodyMedium?.copyWith(color: AppColors.danger)),
            const SizedBox(height: 12),
          ],
          // 一組成員一張卡，不是一人一張。這個 ListView 本來就是非惰性的
          // （children 不是 itemBuilder），折起來不會多建任何東西。
          LedgerCard(
            children: [
              for (var i = 0; i < list.length; i++) ...[
                if (i > 0) const LedgerDivider(),
                _MemberCard(
                  member: list[i],
                  isSelf: list[i].uid == uid,
                  canManage: canManage,
                  busy: _busyUid == list[i].uid,
                  onPromote: () => _run(
                    list[i].uid,
                    () => ref
                        .read(taskRepositoryProvider)
                        .setMemberRole(widget.task.id, list[i].uid, 'admin'),
                  ),
                  onDemote: () => _run(
                    list[i].uid,
                    () => ref
                        .read(taskRepositoryProvider)
                        .setMemberRole(widget.task.id, list[i].uid, 'member'),
                  ),
                  onRemove: () => _remove(list[i]),
                  onRename: () => _rename(list[i]),
                ),
              ],
            ],
          ),
          const SizedBox(height: AppSpace.x3),
          if (canManage) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('新增沒有帳號的成員', style: text.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      '長輩這類沒有 Google 帳號的人，可以先用名字記進帳裡 —— '
                      '他會照常被分攤、出現在結算，只是不能自己打開這個 App。',
                      style: text.bodySmall,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _virtualNickname,
                      maxLength: 20,
                      decoration: const InputDecoration(
                        hintText: '例如：阿嬤',
                        counterText: '',
                      ),
                      onSubmitted: (_) => _addVirtual(),
                    ),
                    const SizedBox(height: 10),
                    FilledButton(
                      onPressed: _addingVirtual ? null : _addVirtual,
                      child: Text(_addingVirtual ? '新增中…' : '新增'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          const SizedBox(height: 8),
          Text(
            '移除只拿掉權限，既有支出與結算金額都會保留 —— '
            '他的名字仍然留在那些帳上。',
            style: text.bodySmall,
          ),
        ],
      ),
    );
  }
}

/// 改名對話框。
///
/// 做成 StatefulWidget 只為了一件事：**controller 要由對話框自己持有**。
///
/// 原本是在 `showDialog` 的 Future 回來之後就 `controller.dispose()`，
/// 那會 crash（`_dependents.isEmpty` assertion）。Future 在路由 pop 的當下
/// 就完成了，但關閉動畫還在跑、TextField 還掛在樹上，這時候把它的 controller
/// 拆掉就踩到 element 拆解的檢查。
///
/// State 的 `dispose()` 是在路由真的離開之後才呼叫的，時機才對。
class _RenameDialog extends StatefulWidget {
  final String initial;

  const _RenameDialog({required this.initial});

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initial);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() => Navigator.of(context).pop(_controller.text.trim());

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('改名'),
      content: TextField(
        controller: _controller,
        autofocus: true,
        maxLength: 20,
        decoration: const InputDecoration(counterText: ''),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(
          style: TextButton.styleFrom(foregroundColor: AppColors.muted),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        TextButton(onPressed: _submit, child: const Text('儲存')),
      ],
    );
  }
}

class _MemberCard extends StatelessWidget {
  final TaskMember member;
  final bool isSelf;
  final bool canManage;
  final bool busy;
  final VoidCallback onPromote;
  final VoidCallback onDemote;
  final VoidCallback onRemove;
  final VoidCallback onRename;

  const _MemberCard({
    required this.member,
    required this.isSelf,
    required this.canManage,
    required this.busy,
    required this.onPromote,
    required this.onDemote,
    required this.onRemove,
    required this.onRename,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    // owner 不能被降級或移除，自己也不能對自己動作。
    final showActions = canManage && !isSelf && member.role != 'owner' && member.active;

    // 虛擬成員沒有帳號，升成 admin 不會讓任何人拿到權限，規則也擋著。
    // 這裡收起來只是不要讓人按了才失敗。
    final showRoleActions = showActions && !member.virtual;

    final label = switch (member.role) {
      'owner' => '擁有者',
      'admin' => '管理員',
      _ => member.virtual ? '成員 · 無帳號' : '成員',
    };

    // 自己不再是一張卡 —— 外面那張 LedgerCard 是容器，這裡只負責一列。
    return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.x4,
          vertical: AppSpace.x3,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor:
                      member.active ? AppColors.primarySoft : AppColors.line,
                  child: Text(
                    member.nickname.isEmpty
                        ? '?'
                        : member.nickname.characters.first,
                    style: TextStyle(
                      /*
                        primaryDeep 而不是 primary。這是**文字**印在
                        primarySoft 上：primary 只有 3.2:1，primaryDark 是
                        4.17，兩個都過不了 4.5。primaryDeep 約 6.6。

                        上一輪的稽核說 Flutter 沒有把 primary 當文字用的
                        地方，這是它漏掉的第二處。
                      */
                      color: member.active
                          ? AppColors.primaryDeep
                          : AppColors.muted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        memberDisplayName(member),
                        style: text.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          color:
                              member.active ? AppColors.ink : AppColors.muted,
                        ),
                      ),
                      Text(
                        member.active
                            ? '$label${isSelf ? ' · 你' : ''}'
                            : '已移除',
                        style: text.bodySmall,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (showActions) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  // 兩個平行條件而不是巢狀的 if/else —— collection-if 裡的
                  // 懸掛 else 讀起來會讓人猶豫，這裡條件夠簡單不值得。
                  if (showRoleActions && member.role == 'member')
                    OutlinedButton(
                      onPressed: busy ? null : onPromote,
                      child: const Text('升為管理員'),
                    ),
                  if (showRoleActions && member.role != 'member')
                    OutlinedButton(
                      onPressed: busy ? null : onDemote,
                      child: const Text('降為成員'),
                    ),
                  // 真實成員的暱稱來自個人資料、他自己改；虛擬成員的名字是
                  // 別人替他打的，打錯就沒有其他管道能修。
                  if (member.virtual)
                    OutlinedButton(
                      onPressed: busy ? null : onRename,
                      child: const Text('改名'),
                    ),
                  if (member.role == 'member')
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.danger,
                      ),
                      onPressed: busy ? null : onRemove,
                      child: const Text('移除'),
                    ),
                ],
              ),
            ],
          ],
        ),
    );
  }
}
