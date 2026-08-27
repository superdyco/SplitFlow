import 'package:flutter/material.dart';

import '../domain/task_actions.dart';
import 'theme.dart';

/// 確認對話框。`src/components/common/ConfirmDialog.vue` 的 Flutter 版。
///
/// 特別的地方是 [TaskActionPrompt.requireText]：不是 null 的話，
/// 使用者要**照著打出那串字**才按得下確認。
///
/// 這是分級摩擦 —— 建錯的空任務刪掉風險是零，逼他打字只是懲罰；
/// 有 100 筆支出的旅程被誤刪是不可逆的，那時候打一次名字的過程，
/// 本身就是在確認自己刪的是哪一個。
Future<bool> showConfirmDialog(
  BuildContext context,
  TaskActionPrompt prompt,
) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => _ConfirmDialog(prompt: prompt),
  );
  return ok == true;
}

class _ConfirmDialog extends StatefulWidget {
  final TaskActionPrompt prompt;

  const _ConfirmDialog({required this.prompt});

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
    final required = widget.prompt.requireText;
    if (required == null) return true;
    return _typed.text.trim() == required.trim();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final prompt = widget.prompt;

    return AlertDialog(
      title: Text(prompt.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(prompt.message),
          if (prompt.requireText != null) ...[
            const SizedBox(height: 16),
            Text('請打出「${prompt.requireText}」以確認：', style: text.bodySmall),
            const SizedBox(height: 6),
            TextField(
              controller: _typed,
              autofocus: true,
              onChanged: (_) => setState(() {}),
            ),
          ],
        ],
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
                prompt.destructive ? AppColors.danger : AppColors.primary,
          ),
          onPressed: _canConfirm ? () => Navigator.of(context).pop(true) : null,
          child: Text(prompt.confirmLabel),
        ),
      ],
    );
  }
}
