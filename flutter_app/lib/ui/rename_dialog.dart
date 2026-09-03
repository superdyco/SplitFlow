/// 「改個名字」的對話框。成員與任務共用。
///
/// 抽出來是因為第二個地方要用它。原本它是 `members_tab.dart` 裡的私有 widget，
/// 標題與字數上限都寫死成成員的那一套 —— 複製一份給任務的話，兩個對話框
/// 之後會慢慢長得不一樣，而它們對使用者是同一件事。
///
/// 網頁版的對應物是 `src/components/common/PromptDialog.vue`。
library;

import 'package:flutter/material.dart';

import 'theme.dart';

/// 開一個改名對話框。按取消或關掉回 null，按儲存回**去掉頭尾空白**的字串。
///
/// 空字串也會回傳 —— 呼叫端要自己判斷。判斷交給呼叫端是因為「改成空的」
/// 在不同地方的意思不一樣，這一格只負責問。
Future<String?> showRenameDialog(
  BuildContext context, {
  required String title,
  required String initial,
  required int maxLength,
  String? hint,
}) {
  return showDialog<String>(
    context: context,
    builder: (context) => _RenameDialog(
      title: title,
      initial: initial,
      maxLength: maxLength,
      hint: hint,
    ),
  );
}

class _RenameDialog extends StatefulWidget {
  final String title;
  final String initial;
  final int maxLength;
  final String? hint;

  const _RenameDialog({
    required this.title,
    required this.initial,
    required this.maxLength,
    this.hint,
  });

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initial);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() => Navigator.of(context).pop(_controller.text.trim());

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _controller,
            autofocus: true,
            maxLength: widget.maxLength,
            decoration: const InputDecoration(counterText: ''),
            onSubmitted: (_) => _submit(),
          ),
          if (widget.hint != null) ...[
            const SizedBox(height: AppSpace.x2),
            Text(widget.hint!, style: text.bodySmall),
          ],
        ],
      ),
      actions: [
        TextButton(
          style: TextButton.styleFrom(foregroundColor: AppColors.muted),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        TextButton(onPressed: _submit, child: const Text('儲存')),
      ],
    );
  }
}
