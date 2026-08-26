import 'package:flutter/material.dart';

import '../domain/currency.dart';

/// 記錄一筆付款的輸入框。`SettlementPanel.vue` 裡那個展開式表單的
/// Flutter 版，做成 bottom sheet。
///
/// 預設帶入建議轉帳的金額，但可以改 —— 實際還錢常常是湊整數或分次還，
/// 硬性等於建議金額的話，使用者就只能不記帳。
///
/// 回傳最小單位整數；取消回 null。
Future<int?> showPaymentSheet(
  BuildContext context, {
  required String fromName,
  required String toName,
  required String currency,
  required int suggested,
}) {
  return showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    builder: (context) => _PaymentSheet(
      fromName: fromName,
      toName: toName,
      currency: currency,
      suggested: suggested,
    ),
  );
}

class _PaymentSheet extends StatefulWidget {
  final String fromName;
  final String toName;
  final String currency;
  final int suggested;

  const _PaymentSheet({
    required this.fromName,
    required this.toName,
    required this.currency,
    required this.suggested,
  });

  @override
  State<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends State<_PaymentSheet> {
  late final TextEditingController _amount;
  String? _error;

  @override
  void initState() {
    super.initState();
    _amount = TextEditingController(
      text: amountToInput(widget.suggested, widget.currency),
    );
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  void _submit() {
    try {
      Navigator.of(context)
          .pop(parseAmountInput(_amount.text, widget.currency));
    } on FormatException catch (err) {
      setState(() => _error = err.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Padding(
      // 鍵盤推上來時整張表單要跟著上移，不然輸入框會被蓋住。
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('記錄付款', style: text.titleMedium),
          const SizedBox(height: 4),
          Text('${widget.fromName} → ${widget.toName}', style: text.bodySmall),
          const SizedBox(height: 16),
          TextField(
            controller: _amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              prefixText: '${widget.currency} ',
              errorText: _error,
            ),
            onChanged: (_) => setState(() => _error = null),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 8),
          Text(
            '金額可以改 —— 湊整數或分次還都記得起來。'
            '記完之後要等收款人確認，才會從結算金額裡扣除。',
            style: text.bodySmall,
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: _submit, child: const Text('記錄')),
        ],
      ),
    );
  }
}
