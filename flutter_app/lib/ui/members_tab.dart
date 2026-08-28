import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/expense_actions.dart';
import '../domain/models.dart';
import '../domain/offline_write.dart';
import '../state/providers.dart';
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
    final controller = TextEditingController(text: member.nickname);
    final next = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('改名'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 20,
          decoration: const InputDecoration(counterText: ''),
          onSubmitted: (value) => Navigator.of(context).pop(value.trim()),
        ),
        actions: [
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.muted),
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('儲存'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (next == null || next.isEmpty || next == member.nickname) return;

    await _run(
      member.uid,
      () => ref
          .read(taskRepositoryProvider)
          .renameMember(widget.task.id, member.uid, next),
    );
  }

  Future<void> _remove(TaskMember member) async {
    // 未結清時的後果要講清楚 —— 移除只拿掉權限，帳目原封不動，
    // 但他從此看不到這個任務，也沒辦法自己記錄付款。
    final settlement = ref.read(settlementProvider(widget.task.id)).value;
    final balance = settlement?.balances
            .where((b) => b.uid == member.uid)
            .map((b) => b.balance)
            .firstOrNull ??
        0;

    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('移除成員'),
        content: Text(removeMemberMessage(
          name: member.nickname,
          balance: balance,
          currency: widget.task.defaultCurrency,
        )),
        actions: [
          // 取消刻意用灰的：兩顆都是主色的話，紅的那顆就不顯眼了。
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.muted),
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('移除'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    await _run(
      member.uid,
      () => ref
          .read(taskRepositoryProvider)
          .removeMember(widget.task.id, member.uid),
    );
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
          for (final member in list) ...[
            _MemberCard(
              member: member,
              isSelf: member.uid == uid,
              canManage: canManage,
              busy: _busyUid == member.uid,
              onPromote: () => _run(
                member.uid,
                () => ref
                    .read(taskRepositoryProvider)
                    .setMemberRole(widget.task.id, member.uid, 'admin'),
              ),
              onDemote: () => _run(
                member.uid,
                () => ref
                    .read(taskRepositoryProvider)
                    .setMemberRole(widget.task.id, member.uid, 'member'),
              ),
              onRemove: () => _remove(member),
              onRename: () => _rename(member),
            ),
            const SizedBox(height: 10),
          ],
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

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor:
                      member.active ? AppColors.primarySoft : AppColors.line,
                  child: Text(
                    member.nickname.isEmpty
                        ? '?'
                        : member.nickname.characters.first,
                    style: TextStyle(
                      color:
                          member.active ? AppColors.primary : AppColors.muted,
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
                        member.nickname.isEmpty ? '（沒有暱稱）' : member.nickname,
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
      ),
    );
  }
}
