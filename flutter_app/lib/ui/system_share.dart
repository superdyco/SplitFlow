import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

/// 開啟原生分享選單。iPad 需要來源位置才能正確顯示 popover，所以由按鈕本身的
/// context 算出錨點。若平台沒有分享服務（模擬器很常見），就退回複製文字。
Future<void> shareText(
  BuildContext context, {
  required String text,
  required String title,
  String? subject,
}) async {
  final box = context.findRenderObject() as RenderBox?;
  final origin = box == null || !box.hasSize
      ? null
      : box.localToGlobal(Offset.zero) & box.size;

  try {
    final result = await SharePlus.instance.share(
      ShareParams(
        text: text,
        title: title,
        subject: subject,
        sharePositionOrigin: origin,
      ),
    );
    if (result.status != ShareResultStatus.unavailable) return;
  } catch (_) {
    // 沒有可處理分享的 App 或平台通道失敗時，下面仍把內容交給使用者。
  }

  await Clipboard.setData(ClipboardData(text: text));
  if (!context.mounted) return;
  ScaffoldMessenger.of(
    context,
  ).showSnackBar(const SnackBar(content: Text('這台裝置無法開啟分享，內容已複製')));
}

Future<void> shareFile(
  BuildContext context, {
  required String path,
  required String fileName,
  required String title,
}) async {
  final box = context.findRenderObject() as RenderBox?;
  final origin = box == null || !box.hasSize
      ? null
      : box.localToGlobal(Offset.zero) & box.size;
  final result = await SharePlus.instance.share(
    ShareParams(
      files: [XFile(path, mimeType: 'application/json')],
      fileNameOverrides: [fileName],
      title: title,
      sharePositionOrigin: origin,
    ),
  );
  if (result.status == ShareResultStatus.unavailable) {
    throw StateError('這台裝置沒有可儲存檔案的應用程式');
  }
}
