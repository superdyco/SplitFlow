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
            ),
            const SizedBox(height: 10),
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

  const _MemberCard({
    required this.member,
    required this.isSelf,
    required this.canManage,
    required this.busy,
    required this.onPromote,
    required this.onDemote,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    // owner 不能被降級或移除，自己也不能對自己動作。
    final showActions = canManage && !isSelf && member.role != 'owner' && member.active;

    final label = switch (member.role) {
      'owner' => '擁有者',
      'admin' => '管理員',
      _ => '成員',
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
              Row(
                children: [
                  if (member.role == 'member')
                    OutlinedButton(
                      onPressed: busy ? null : onPromote,
                      child: const Text('升為管理員'),
                    )
                  else
                    OutlinedButton(
                      onPressed: busy ? null : onDemote,
                      child: const Text('降為成員'),
                    ),
                  const SizedBox(width: 8),
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
