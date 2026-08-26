import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/currency.dart';
import '../domain/models.dart';
import '../domain/offline_write.dart';
import '../domain/payment_actions.dart';
import '../domain/settlement_text.dart';
import '../state/providers.dart';
import 'payment_sheet.dart';
import 'theme.dart';

/// 結算分頁。`src/components/settlement/SettlementPanel.vue` 的 Flutter 版。
///
/// 除了算出來的金額，這裡也是記錄與確認付款的地方 —— 誰可以按哪個按鈕
/// 由 `lib/domain/payment_actions.dart` 決定，跟 firestore.rules 是同一組規則。
class SettlementTab extends ConsumerStatefulWidget {
  final Task task;
  final bool archived;

  const SettlementTab({super.key, required this.task, required this.archived});

  @override
  ConsumerState<SettlementTab> createState() => _SettlementTabState();
}

class _SettlementTabState extends ConsumerState<SettlementTab> {
  bool _busy = false;
  String? _error;

  Task get task => widget.task;
  bool get _canWrite => !widget.archived;
  String get _uid => ref.read(authStateProvider).value?.uid ?? '';

  bool get _isAdmin {
    final uid = _uid;
    return task.ownerId == uid || task.adminIds.contains(uid);
  }

  /// 付款一動，結算跟著變 —— 兩個都要重讀，不然畫面上的金額跟剛記的那筆對不起來。
  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await settleWrite(action());
      ref.invalidate(paymentsProvider(task.id));
      ref.invalidate(settlementProvider(task.id));
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _record({
    required String from,
    required String to,
    required int suggested,
    required Map<String, String> names,
  }) async {
    final amount = await showPaymentSheet(
      context,
      fromName: names[from] ?? '已離開的成員',
      toName: names[to] ?? '已離開的成員',
      currency: task.defaultCurrency,
      suggested: suggested,
    );
    if (amount == null || !mounted) return;

    final uid = _uid;
    await _run(() => ref.read(paymentRepositoryProvider).createPayment(
          task.id,
          paymentInput(
            from: from,
            to: to,
            amount: amount,
            currency: task.defaultCurrency,
            currentUid: uid,
          ),
          uid,
        ));
  }

  Future<void> _delete(Payment payment, Map<String, String> names) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('刪除付款記錄'),
        content: Text(
          '${names[payment.from] ?? '已離開的成員'} 付給 '
          '${names[payment.to] ?? '已離開的成員'} '
          '${task.defaultCurrency} '
          '${formatAmount(payment.amount, task.defaultCurrency)}。\n\n'
          '刪掉之後這筆金額會加回結算裡。',
        ),
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
            child: const Text('刪除'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    await _run(() =>
        ref.read(paymentRepositoryProvider).deletePayment(task.id, payment.id));
  }

  @override
  Widget build(BuildContext context) {
    final settlement = ref.watch(settlementProvider(task.id));
    final members = ref.watch(membersProvider(task.id));
    final payments = ref.watch(paymentsProvider(task.id));
    final text = Theme.of(context).textTheme;

    return settlement.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text('算不出結算：$err', textAlign: TextAlign.center),
        ),
      ),
      data: (result) {
        final names = {
          for (final m in members.value ?? const <TaskMember>[])
            m.uid: m.nickname,
        };
        final all = payments.value ?? const <Payment>[];
        final pending = all.where((p) => p.status != 'confirmed').toList();
        final confirmed = all.where((p) => p.status == 'confirmed').toList();
        final uid = _uid;

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
            if (pending.isNotEmpty)
              _Warning('有 ${pending.length} 筆付款等待確認，還沒從下面的金額扣除'),

            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  style: text.bodyMedium?.copyWith(color: AppColors.danger)),
            ],

            const SizedBox(height: 20),
            Text('誰欠誰', style: text.titleMedium),
            const SizedBox(height: 8),
            if (result.transfers.isEmpty)
              Text('大家都已結清，不需要轉帳。', style: text.bodyMedium)
            else
              for (final transfer in result.transfers)
                _TransferRow(
                  label: '${names[transfer.from] ?? '已離開的成員'} → '
                      '${names[transfer.to] ?? '已離開的成員'}',
                  amount: '${result.currency} '
                      '${formatAmount(transfer.amount, result.currency)}',
                  busy: _busy,
                  onRecord: canRecordPayment(
                    canWrite: _canWrite,
                    currentUid: uid,
                    from: transfer.from,
                    isAdmin: _isAdmin,
                  )
                      ? () => _record(
                            from: transfer.from,
                            to: transfer.to,
                            suggested: transfer.amount,
                            names: names,
                          )
                      : null,
                ),

            if (all.isNotEmpty) ...[
              const SizedBox(height: 24),
              Text('付款記錄', style: text.titleMedium),
              const SizedBox(height: 8),
              // 待確認的排前面 —— 那些才是需要有人動手的。
              for (final payment in [...pending, ...confirmed])
                _PaymentRow(
                  payment: payment,
                  names: names,
                  currency: task.defaultCurrency,
                  busy: _busy,
                  onConfirm: canConfirmPayment(
                    canWrite: _canWrite,
                    currentUid: uid,
                    payment: payment,
                    isAdmin: _isAdmin,
                  )
                      ? () => _run(() => ref
                          .read(paymentRepositoryProvider)
                          .confirmPayment(task.id, payment.id))
                      : null,
                  onDelete: canDeletePayment(
                    canWrite: _canWrite,
                    currentUid: uid,
                    payment: payment,
                    isAdmin: _isAdmin,
                  )
                      ? () => _delete(payment, names)
                      : null,
                ),
            ],

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
              onPressed: () => _copy(context, result, names, pending.length),
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

class _TransferRow extends StatelessWidget {
  final String label;
  final String amount;
  final bool busy;
  final VoidCallback? onRecord;

  const _TransferRow({
    required this.label,
    required this.amount,
    required this.busy,
    required this.onRecord,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(label, style: text.bodyMedium)),
          Text(
            amount,
            style: text.bodyMedium?.copyWith(
              fontWeight: FontWeight.w700,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          if (onRecord != null) ...[
            const SizedBox(width: 4),
            TextButton(
              onPressed: busy ? null : onRecord,
              child: const Text('記錄'),
            ),
          ],
        ],
      ),
    );
  }
}

class _PaymentRow extends StatelessWidget {
  final Payment payment;
  final Map<String, String> names;
  final String currency;
  final bool busy;
  final VoidCallback? onConfirm;
  final VoidCallback? onDelete;

  const _PaymentRow({
    required this.payment,
    required this.names,
    required this.currency,
    required this.busy,
    required this.onConfirm,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final done = payment.status == 'confirmed';

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${names[payment.from] ?? '已離開的成員'} → '
                    '${names[payment.to] ?? '已離開的成員'}',
                    style: text.bodyMedium,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        '$currency ${formatAmount(payment.amount, currency)}',
                        style: text.bodySmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        done ? '已確認' : '待確認',
                        style: text.bodySmall?.copyWith(
                          color: done ? AppColors.success : AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (onConfirm != null)
              TextButton(
                onPressed: busy ? null : onConfirm,
                child: const Text('確認收到'),
              ),
            if (onDelete != null)
              IconButton(
                tooltip: '刪除',
                color: AppColors.danger,
                onPressed: busy ? null : onDelete,
                icon: const Icon(Icons.delete_outline, size: 20),
              ),
          ],
        ),
      ),
    );
  }
}

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
