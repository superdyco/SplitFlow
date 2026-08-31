import 'package:flutter/material.dart';

import 'theme.dart';

/// 確認對話框。`src/components/common/ConfirmDialog.vue` 的 Flutter 版。
///
/// 特別的地方是 [requireText]：不是 null 的話，使用者要**照著打出那串字**
/// 才按得下確認。
///
/// 這是分級摩擦 —— 建錯的空任務刪掉風險是零，逼他打字只是懲罰；
/// 有 100 筆支出的旅程被誤刪是不可逆的，那時候打一次名字的過程，
/// 本身就是在確認自己刪的是哪一個。
///
/// 收的是個別欄位而不是某一種 prompt 物件：任務動作與刪除帳號各有自己的
/// 文案型別，而「破壞性」也不見得推導得出來 —— 刪除帳號永遠是破壞性的，
/// 但它沒有任務可以打名字，requireText 會是 null。
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  String? requireText,
  bool destructive = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => _ConfirmDialog(
      title: title,
      message: message,
      confirmLabel: confirmLabel,
      requireText: requireText,
      destructive: destructive,
    ),
  );
  return ok == true;
}

class _ConfirmDialog extends StatefulWidget {
  final String title;
  final String message;
  final String confirmLabel;
  final String? requireText;
  final bool destructive;

  const _ConfirmDialog({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.requireText,
    required this.destructive,
  });

  @override
  State<_ConfirmDialog> createState() => _ConfirmDialogState();
}

class _ConfirmDialogState extends State<_ConfirmDialog> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  bool get _canConfirm {
    final required = widget.requireText;
    if (required == null) return true;
    return _typed.text.trim() == required.trim();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return AlertDialog(
      title: Text(widget.title),
      // 訊息很長時（刪除帳號會列出任務數）在小螢幕上要能捲。
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.message),
            if (widget.requireText != null) ...[
              const SizedBox(height: 16),
              Text('請打出「${widget.requireText}」以確認：', style: text.bodySmall),
              const SizedBox(height: 6),
              TextField(
                controller: _typed,
                autofocus: true,
                onChanged: (_) => setState(() {}),
              ),
            ],
          ],
        ),
      ),
      actions: [
        // 取消刻意用灰的：兩顆都是主色的話，紅的那顆就不顯眼了。
        TextButton(
          style: TextButton.styleFrom(foregroundColor: AppColors.muted),
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        TextButton(
          style: TextButton.styleFrom(
            foregroundColor:
                widget.destructive ? AppColors.danger : AppColors.primary,
          ),
          onPressed: _canConfirm ? () => Navigator.of(context).pop(true) : null,
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}
