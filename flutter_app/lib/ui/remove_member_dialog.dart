import 'package:flutter/material.dart';

import '../domain/member_footprint.dart';
import 'theme.dart';

/// 移除成員的對話框。`src/components/member/RemoveMemberDialog.vue` 的 Flutter 版。
///
/// 跟 `showConfirmDialog` 分開的理由是它給不了三個出口 —— 這裡要
/// 「取消 / 保留結算資料 / 真實移除」。
///
/// 刻意不要求打出名字：那層摩擦留給刪整個任務（`taskActionPrompt`）。
/// 這裡已經是兩段式的選擇，而且訊息把後果都講明了。
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

class _RemoveMemberDialog extends StatelessWidget {
  final RemoveMemberPrompt prompt;

  const _RemoveMemberDialog({required this.prompt});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(prompt.title),
      content: SingleChildScrollView(child: Text(prompt.message)),
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
          onPressed: () => Navigator.of(context).pop(RemoveMemberChoice.hard),
          child: Text(prompt.hasRecords ? '真實移除' : '刪除'),
        ),
      ],
    );
  }
}
