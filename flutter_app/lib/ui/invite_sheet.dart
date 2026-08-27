import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../domain/invite.dart';
import 'theme.dart';

/// 邀請連結的分享面板。
///
/// 網頁版那顆「邀請」鈕是直接複製、把文字換成「已複製」。手機上多一步
/// 把連結攤出來看，是因為傳出去之前值得確認一眼傳的是哪一個旅程 ——
/// 手機上同時開著好幾個對話，貼錯群組的代價是把陌生人放進帳本裡。
Future<void> showInviteSheet(
  BuildContext context, {
  required String taskName,
  required String inviteCode,
}) {
  final url = inviteUrl(inviteCode);

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) {
      final text = Theme.of(context).textTheme;

      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('邀請加入', style: text.titleMedium),
              const SizedBox(height: 4),
              Text(taskName, style: text.bodySmall),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.line),
                ),
                child: SelectableText(url, style: text.bodySmall),
              ),
              const SizedBox(height: 12),
              Text(
                '對方用瀏覽器打開就能加入，不用先裝 App。'
                '他會先看到旅程名稱，登入之後才進得來。',
                style: text.bodySmall,
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                icon: const Icon(Icons.copy, size: 18),
                label: const Text('複製邀請連結'),
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: url));
                  if (!context.mounted) return;
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('已複製邀請連結')),
                  );
                },
              ),
            ],
          ),
        ),
      );
    },
  );
}
