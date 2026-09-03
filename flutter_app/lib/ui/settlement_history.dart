import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../domain/currency.dart';
import '../domain/models.dart';
import '../domain/settlement.dart';
import '../domain/settlement_text.dart';
import 'system_share.dart';
import 'ledger.dart';
import 'theme.dart';

/// 結算紀錄。`src/components/settlement/SettlementHistory.vue` 的 Flutter 版。
///
/// 存一份「當時算出來是這樣」。用處是回國之後帳目又動了（有人補記一筆、
/// 有人確認了付款），還查得到那天大家講好的數字是多少。
///
/// 快照**自帶當時的暱稱**，所以有人改名或離開任務之後，紀錄顯示的仍是
/// 結算當下的名字，不會被後來的變動改寫。
class SettlementHistory extends StatefulWidget {
  final Settlement settlement;
  final List<SettlementSnapshot> snapshots;
  final String taskName;
  final bool canManage;
  final bool busy;

  final void Function(String note) onSave;
  final void Function(SettlementSnapshot snapshot) onRemove;

  const SettlementHistory({
    super.key,
    required this.settlement,
    required this.snapshots,
    required this.taskName,
    required this.canManage,
    required this.busy,
    required this.onSave,
    required this.onRemove,
  });

  @override
  State<SettlementHistory> createState() => _SettlementHistoryState();
}

class _SettlementHistoryState extends State<SettlementHistory> {
  final _note = TextEditingController();

  bool _composing = false;
  String? _openId;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  SettlementSnapshot? get _latest =>
      widget.snapshots.isEmpty ? null : widget.snapshots.first;

  /// 上次存快照之後帳目有沒有再變動。沒有快照就不用提示。
  bool get _changedSinceLatest {
    final latest = _latest;
    return latest != null && !matchesSnapshot(widget.settlement, latest.data);
  }

  void _submit() {
    // 200 字上限跟網頁版一致 —— 備註是一句話，不是日記。
    final note = _note.text.trim();
    widget.onSave(note.length > 200 ? note.substring(0, 200) : note);
    _note.clear();
    setState(() => _composing = false);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('結算紀錄', style: text.titleMedium),
            const Spacer(),
            if (widget.canManage && !_composing)
              TextButton(
                onPressed: widget.busy
                    ? null
                    : () => setState(() => _composing = true),
                child: const Text('儲存這次結算'),
              ),
          ],
        ),
        const SizedBox(height: 4),

        // 這三句是互斥的狀態說明，而且中間那一句是重點：看到舊數字卻以為
        // 是現在的，比看不到還糟。
        if (widget.snapshots.isEmpty)
          Text('還沒有結算紀錄。把目前的結果存下來，之後帳目再變動也查得到當時算出來是多少。', style: text.bodySmall)
        else if (_changedSinceLatest)
          Text(
            '上次結算之後帳目又變動了，下面的紀錄是當時的結果，不是現在的。',
            style: text.bodySmall?.copyWith(color: AppColors.danger),
          )
        else
          Text('目前的帳目跟最近一次結算紀錄一致。', style: text.bodySmall),

        if (_composing) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            maxLength: 200,
            decoration: const InputDecoration(
              labelText: '備註（選填）',
              hintText: '例如：曼谷回國當天結算',
              counterText: '',
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '會把目前的應收應付、轉帳建議與大家的暱稱一起存成一份紀錄。'
            '存下來之後不能修改，只能刪除。',
            style: text.bodySmall,
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              FilledButton(
                onPressed: widget.busy ? null : _submit,
                child: const Text('存成紀錄'),
              ),
              const SizedBox(width: 8),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.muted),
                onPressed: widget.busy
                    ? null
                    : () => setState(() => _composing = false),
                child: const Text('取消'),
              ),
            ],
          ),
        ],

        const SizedBox(height: 8),
        // 一組紀錄一張卡，不是一筆一張。每筆自己一張的時候，展開／收合
        // 會讓整排卡片上下彈跳，看起來像列表重排了。
        LedgerCard(
          children: [
            for (var i = 0; i < widget.snapshots.length; i++) ...[
              if (i > 0) const LedgerDivider(),
              _Entry(
                snapshot: widget.snapshots[i],
                taskName: widget.taskName,
                open: _openId == widget.snapshots[i].id,
                canManage: widget.canManage,
                busy: widget.busy,
                onToggle: () => setState(() {
                  final id = widget.snapshots[i].id;
                  _openId = _openId == id ? null : id;
                }),
                onRemove: () => widget.onRemove(widget.snapshots[i]),
              ),
            ],
          ],
        ),
      ],
    );
  }
}

class _Entry extends StatelessWidget {
  final SettlementSnapshot snapshot;
  final String taskName;
  final bool open;
  final bool canManage;
  final bool busy;
  final VoidCallback onToggle;
  final VoidCallback onRemove;

  const _Entry({
    required this.snapshot,
    required this.taskName,
    required this.open,
    required this.canManage,
    required this.busy,
    required this.onToggle,
    required this.onRemove,
  });

  String get _when {
    final at = snapshot.createdAt;
    // 離線存的還沒有伺服器時間。顯示「剛剛」而不是空白 —— 那一筆確實
    // 是剛存的，只是時間還沒回來。
    if (at == null) return '剛剛';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${at.year}-${two(at.month)}-${two(at.day)} '
        '${two(at.hour)}:${two(at.minute)}';
  }

  String _name(String uid) => snapshot.data.memberNames[uid] ?? '已離開的成員';

  String _shareText() {
    final data = snapshot.data;
    // 用快照自帶的名字，不是現在的成員名單 —— 複製出來的要是當時那份。
    return buildSettlementText(
      SettlementTextInput(
        taskName: taskName,
        currency: data.currency,
        transfers: data.transfers,
        memberNames: data.memberNames,
        expenseCount: data.expenseCount,
        total: data.total,
        unconvertedCount: 0,
        pendingCount: 0,
      ),
    );
  }

  Future<void> _copy(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: _shareText()));
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('已複製當時的結算')));
  }

  Future<void> _share(BuildContext context) {
    return shareText(
      context,
      text: _shareText(),
      title: '$taskName 歷史結算',
      subject: '$taskName 歷史結算',
    );
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final data = snapshot.data;

    // 自己不再是一張卡 —— 外面那張 LedgerCard 是容器。
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _when,
                          style: text.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${data.expenseCount} 筆 · 共 '
                          '${data.currency} '
                          '${formatAmount(data.total, data.currency)}'
                          '${data.note.isEmpty ? '' : ' · ${data.note}'}',
                          style: text.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  Icon(open ? Icons.expand_less : Icons.expand_more, size: 20),
                ],
              ),
            ),
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Divider(),
                  Text('當時的應收應付', style: text.bodySmall),
                  const SizedBox(height: 6),
                  for (final item in data.balances)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _name(item.uid),
                              style: text.bodyMedium,
                            ),
                          ),
                          Text(
                            item.balance == 0
                                ? '已結清'
                                : '${item.balance > 0 ? '應收 ' : '應付 '}'
                                      '${formatAmount(item.balance.abs(), data.currency)}',
                            style: text.bodyMedium?.copyWith(
                              color: item.balance == 0
                                  ? AppColors.muted
                                  : (item.balance > 0
                                        ? AppColors.success
                                        : AppColors.danger),
                            ),
                          ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Text('當時的轉帳建議', style: text.bodySmall),
                      const Spacer(),
                      Builder(
                        builder: (shareContext) => TextButton.icon(
                          onPressed: () => _share(shareContext),
                          icon: const Icon(Icons.share_outlined, size: 17),
                          label: const Text('分享'),
                        ),
                      ),
                      TextButton(
                        onPressed: () => _copy(context),
                        child: const Text('複製'),
                      ),
                    ],
                  ),
                  if (data.transfers.isEmpty)
                    Text('當時已經全部結清。', style: text.bodySmall)
                  else
                    for (final transfer in data.transfers)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                '${_name(transfer.from)} → ${_name(transfer.to)}',
                                style: text.bodyMedium,
                              ),
                            ),
                            Text(
                              formatAmount(transfer.amount, data.currency),
                              style: figure(size: 14),
                            ),
                          ],
                        ),
                      ),

                  if (canManage) ...[
                    const SizedBox(height: 12),
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.danger,
                      ),
                      onPressed: busy ? null : onRemove,
                      child: const Text('刪除這筆紀錄'),
                    ),
                  ],
                ],
              ),
            ),
        ],
    );
  }
}
