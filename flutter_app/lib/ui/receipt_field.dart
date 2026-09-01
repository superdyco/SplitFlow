import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../domain/models.dart';
import '../state/providers.dart';
import 'remote_receipt.dart';
import 'theme.dart';

/// 使用者對這一格做過什麼。表單存檔時要靠它決定要不要動 Storage
/// 與 `receipt` 欄位。
enum ReceiptChange {
  /// 沒碰過 —— 存檔時**整個 key 都不要送**，Firestore 會保留原本的值。
  /// 網頁版拍的照片就是這樣不被洗掉的。
  untouched,

  /// 選了新的一張，還沒傳。
  replaced,

  /// 按了移除。
  removed,
}

/// 這一格現在的狀態，交給表單。
class ReceiptState {
  final ReceiptChange change;

  /// [ReceiptChange.replaced] 時是待上傳的檔案，其餘為 null。
  final File? file;

  const ReceiptState(this.change, this.file);

  static const untouched = ReceiptState(ReceiptChange.untouched, null);
}

/// 收據欄位。`src/components/expense/ReceiptField.vue` 的 Flutter 版。
///
/// 跟網頁版不同的地方是**存檔的時機**：網頁版拍完就進佇列、支出標成待上傳，
/// 之後在背景補傳；原生版是按下儲存時才傳，傳成功才寫進文件。
/// 理由寫在 `lib/data/receipt_repository.dart` —— 沒有佇列卻先標成待上傳，
/// 那個狀態就永遠不會變。
class ReceiptField extends ConsumerStatefulWidget {
  final ExpenseReceipt? existing;

  /// 新增支出時還沒有 id，拿不到 Storage 路徑，所以不會有既有照片可看。
  final String? taskId;
  final String? expenseId;

  final bool canManage;
  final ValueChanged<ReceiptState> onChanged;

  const ReceiptField({
    super.key,
    required this.existing,
    required this.taskId,
    required this.expenseId,
    required this.canManage,
    required this.onChanged,
  });

  @override
  ConsumerState<ReceiptField> createState() => _ReceiptFieldState();
}

class _ReceiptFieldState extends ConsumerState<ReceiptField> {
  ReceiptChange _change = ReceiptChange.untouched;
  File? _file;
  String? _error;
  bool _busy = false;

  /// 已經在 Storage 上、而且使用者沒有動過它。
  bool get _showsExisting =>
      _change == ReceiptChange.untouched && (widget.existing?.uploaded ?? false);

  /// 網頁版排隊中的那張。這裡拿不到圖 —— 它在另一台裝置上。
  bool get _showsPending =>
      _change == ReceiptChange.untouched && (widget.existing?.pending ?? false);

  bool get _hasSomething =>
      _file != null || _showsExisting || _showsPending;

  void _emit() => widget.onChanged(ReceiptState(_change, _file));

  Future<void> _pick(ImageSource source) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final file = await ref.read(receiptPickerProvider).pick(source);
      if (file == null || !mounted) return;
      setState(() {
        _file = file;
        _change = ReceiptChange.replaced;
      });
      _emit();
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 拍照與從相簿選都要留著。
  ///
  /// 網頁版那邊刻意不加 `capture="environment"`，理由一樣：實際情境是
  /// 「當場拍」跟「晚上回飯店補進去」各佔一半。
  Future<void> _choose() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('拍一張'),
              onTap: () => Navigator.of(context).pop(ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('從相簿選'),
              onTap: () => Navigator.of(context).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source != null) await _pick(source);
  }

  void _remove() {
    setState(() {
      _file = null;
      _error = null;
      // 本來就沒有東西的話，「移除」不該變成一個要處理的動作 ——
      // 不然新增支出時選了照片又反悔，會去刪一個根本不存在的檔案。
      _change = (widget.existing?.isEmpty ?? true)
          ? ReceiptChange.untouched
          : ReceiptChange.removed;
    });
    _emit();
  }

  Future<void> _view() async {
    final file = _file;
    final path = _showsExisting ? widget.existing?.path : null;
    if (file == null && path == null) return;

    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(12),
        child: GestureDetector(
          onTap: () => Navigator.of(context).pop(),
          // 收據是要看得清楚金額的，能放大才有意義。
          child: InteractiveViewer(
            maxScale: 5,
            child: file != null
                ? Image.file(file)
                : RemoteReceipt(path: path!, fit: BoxFit.contain),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!_hasSomething)
          OutlinedButton.icon(
            onPressed: (_busy || !widget.canManage) ? null : _choose,
            icon: const Icon(Icons.photo_camera_outlined, size: 18),
            label: Text(_busy ? '處理中...' : '拍照或選一張收據'),
          )
        else
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Thumb(
                file: _file,
                remotePath: _showsExisting ? widget.existing?.path : null,
                badge: _file != null
                    ? '未儲存'
                    : (_showsPending ? '待上傳' : null),
                onTap: _showsPending ? null : _view,
              ),
              const SizedBox(width: 12),
              if (widget.canManage)
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      OutlinedButton(
                        onPressed: _busy ? null : _choose,
                        child: const Text('更換'),
                      ),
                      const SizedBox(height: 6),
                      OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.danger,
                        ),
                        onPressed: _busy ? null : _remove,
                        child: const Text('移除'),
                      ),
                    ],
                  ),
                ),
            ],
          ),

        if (_showsPending)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              '這張是在網頁版拍的，還在等網路上傳。用網頁版開著這筆支出'
              '就會自動傳上去 —— 這裡看不到那張圖。',
              style: text.bodySmall,
            ),
          ),

        if (_change == ReceiptChange.removed)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('儲存之後這張收據就會刪掉。',
                style: text.bodySmall?.copyWith(color: AppColors.danger)),
          ),

        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!,
                style: text.bodySmall?.copyWith(color: AppColors.danger)),
          ),
      ],
    );
  }
}

class _Thumb extends StatelessWidget {
  final File? file;
  final String? remotePath;
  final String? badge;
  final VoidCallback? onTap;

  const _Thumb({
    required this.file,
    required this.remotePath,
    required this.badge,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return GestureDetector(
      onTap: onTap,
      child: Stack(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              width: 96,
              height: 96,
              child: file != null
                  ? Image.file(file!, fit: BoxFit.cover)
                  : (remotePath != null
                      ? RemoteReceipt(path: remotePath!, fit: BoxFit.cover)
                      : Container(
                          color: AppColors.line,
                          alignment: Alignment.center,
                          child: Text('收據', style: text.bodySmall),
                        )),
            ),
          ),
          if (badge != null)
            Positioned(
              left: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                color: AppColors.ink.withValues(alpha: 0.72),
                child: Text(
                  badge!,
                  style: text.bodySmall?.copyWith(color: Colors.white),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
