import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/providers.dart';
import 'theme.dart';

/// Storage 上的收據。網址要先問過才拿得到，所以中間有一段載入狀態。
///
/// 從 `receipt_field.dart` 搬出來的：詳情頁也要顯示收據，但那一頁是純唯讀，
/// 不需要整個 `ReceiptField`（一個不能操作的操作元件）。兩邊共用這一塊就好。
class RemoteReceipt extends ConsumerWidget {
  final String path;
  final BoxFit fit;

  const RemoteReceipt({super.key, required this.path, required this.fit});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final url = ref.watch(receiptUrlProvider(path));

    return url.when(
      loading: () => const Center(
        child: SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
      // 讀不到就說讀不到。靜默失敗會讓人以為照片不見了。
      error: (err, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Text(
            '讀不到收據',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: AppColors.danger),
            textAlign: TextAlign.center,
          ),
        ),
      ),
      data: (value) => Image.network(value, fit: fit),
    );
  }
}
