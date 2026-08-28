import 'package:flutter/material.dart';

import '../domain/member_footprint.dart';
import 'theme.dart';

/// 移除成員的對話框。`src/components/member/RemoveMemberDialog.vue` 的 Flutter 版。
///
/// 跟 `showConfirmDialog` 分開的理由是它給不了三個出口 —— 這裡要
/// 「取消 / 保留結算資料 / 真實移除」。摩擦機制（照著打名字才按得下去）
/// 比照 `TaskActionPrompt.requireText`，理由一樣：後果越嚴重、需要越刻意
/// 的動作。沒有帳的人不給選擇也不要求打字。
enum RemoveMemberChoice { cancel, soft, hard }

Future<RemoveMemberChoice> showRemoveMemberDialog(
  BuildContext context,
  RemoveMemberPrompt prompt,
) async {
  final choice = await showDialog<RemoveMemberChoice>(
    context: context,
    builder: (context) => _RemoveMemberDialog(prompt: prompt),
  );
  return choice ?? RemoveMemberChoice.cancel;
}

class _RemoveMemberDialog extends StatefulWidget {
  final RemoveMemberPrompt prompt;

  const _RemoveMemberDialog({required this.prompt});

  @override
  State<_RemoveMemberDialog> createState() => _RemoveMemberDialogState();
}

class _RemoveMemberDialogState extends State<_RemoveMemberDialog> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final prompt = widget.prompt;
    final needsTyping = prompt.requireText;
    final canHardDelete = needsTyping == null || _typed.text.trim() == needsTyping;

    return AlertDialog(
      title: Text(prompt.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(prompt.message),
            if (needsTyping != null) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _typed,
                decoration: InputDecoration(
                  labelText: '請輸入「${needsTyping}」以確認真實移除',
                ),
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
          onPressed: () => Navigator.of(context).pop(RemoveMemberChoice.cancel),
          child: const Text('取消'),
        ),
        if (prompt.hasRecords)
          TextButton(
            onPressed: () =>
                Navigator.of(context).pop(RemoveMemberChoice.soft),
            child: const Text('保留結算資料'),
          ),
        TextButton(
          style: TextButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed: canHardDelete
              ? () => Navigator.of(context).pop(RemoveMemberChoice.hard)
              : null,
          child: Text(prompt.hasRecords ? '真實移除' : '刪除'),
        ),
      ],
    );
  }
}
