import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';
import '../domain/account_deletion.dart';
import '../domain/auth_error.dart' as auth;
import '../domain/models.dart';
import '../domain/validation.dart' as validate;
import '../state/providers.dart';
import 'system_share.dart';
import 'theme.dart';

/// 個人設定。`src/pages/ProfilePage.vue` 的 Flutter 版。
///
/// 網頁版這一頁還有診斷資訊（版本、待上傳收據、錯誤清單）與「我的收藏／探索」
/// 的入口。收藏與探索留在網頁版；診斷資訊等有東西可以診斷再說 ——
/// 目前原生版還沒有離線佇列，抄過來的會是一份空表。
///
/// 拆成外層等資料、內層畫表單兩個 widget，是因為表單的
/// `TextEditingController` 要用暱稱當初始值。如果在 `initState` 裡讀
/// `FutureProvider.value`，那時候它還在載入中、必然是 null，欄位會是空的 ——
/// 使用者看到空白暱稱，一存就把原本的名字清掉了。
class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(userProfileProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('個人設定')),
      body: profile.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Text('讀取個人資料失敗：$err', textAlign: TextAlign.center),
          ),
        ),
        data: (value) => value == null
            ? const Center(child: Text('找不到個人資料。'))
            : _Form(profile: value),
      ),
    );
  }
}

class _Form extends ConsumerStatefulWidget {
  final UserProfile profile;

  const _Form({required this.profile});

  @override
  ConsumerState<_Form> createState() => _FormState();
}

class _FormState extends ConsumerState<_Form> {
  late final TextEditingController _nickname;
  late String _initial;

  bool _touched = false;
  bool _saving = false;
  bool _saved = false;
  bool _exporting = false;
  String _exportProgress = '';
  bool _deleting = false;
  String? _error;

  Future<void> _deleteAccount() async {
    // 任務清單還沒載完就當作沒有任務。確認訊息會少講一段，但不該擋住
    // 這條路 —— 真正的刪除在雲端執行，不依賴這份清單。
    final tasks = ref.read(tasksProvider).value ?? const <Task>[];
    final uid = ref.read(authStateProvider).value?.uid;

    final prompt = deleteAccountPrompt(
      nickname: _nickname.text.trim(),
      taskCount: tasks.length,
      ownedTaskCount: tasks.where((task) => task.ownerId == uid).length,
    );

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => _ConfirmDeleteDialog(prompt: prompt),
    );
    if (confirmed != true) return;

    setState(() {
      _deleting = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).deleteAccount();
      if (mounted) Navigator.of(context).pop();
    } on SignInCancelled {
      // 重新驗證時自己取消，不是錯誤。
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  @override
  void initState() {
    super.initState();
    // 這裡拿得到真的暱稱 —— 資料已經由外層等好了。
    _initial = widget.profile.nickname;
    _nickname = TextEditingController(text: _initial);
  }

  @override
  void dispose() {
    _nickname.dispose();
    super.dispose();
  }

  String? get _nicknameError =>
      validate.textFieldError(_nickname.text, '暱稱', max: 20, touched: _touched);

  bool get _dirty => _nickname.text.trim() != _initial.trim();
  bool get _canSubmit =>
      _nickname.text.trim().isNotEmpty && _nicknameError == null && _dirty;

  Future<void> _save() async {
    setState(() => _touched = true);
    if (!_canSubmit) return;

    setState(() {
      _saving = true;
      _error = null;
      _saved = false;
    });

    try {
      await ref
          .read(userRepositoryProvider)
          .updateNickname(widget.profile.uid, validate.required(_nickname.text, '暱稱'));
      if (!mounted) return;
      setState(() {
        _initial = _nickname.text;
        _saved = true;
        _saving = false;
      });
      ref.invalidate(userProfileProvider);
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _saving = false;
        });
      }
    }
  }

  Future<void> _export(BuildContext shareContext) async {
    if (_exporting) return;
    setState(() {
      _exporting = true;
      _exportProgress = '正在整理分帳資料';
      _error = null;
    });
    try {
      final file = await ref
          .read(dataExportRepositoryProvider)
          .export(
            widget.profile.uid,
            onProgress: (progress) {
              if (mounted) setState(() => _exportProgress = progress.message);
            },
          );
      if (!mounted || !shareContext.mounted) return;
      await shareFile(
        shareContext,
        path: file.path,
        fileName: file.uri.pathSegments.last,
        title: '簡單分帳資料匯出',
      );
      if (mounted) setState(() => _exportProgress = '匯出完成');
    } catch (err) {
      if (mounted) setState(() => _error = '匯出失敗：$err');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final user = ref.watch(authStateProvider).value;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('暱稱', style: text.bodySmall),
                const SizedBox(height: 6),
                TextField(
                  controller: _nickname,
                  maxLength: 20,
                  onChanged: (_) => setState(() => _saved = false),
                  onTapOutside: (_) => setState(() => _touched = true),
                ),
                if (_nicknameError != null)
                  Text(_nicknameError!,
                      style: text.bodySmall?.copyWith(color: AppColors.danger)),
                const SizedBox(height: 8),
                Text('同行的人在支出與結算上看到的就是這個名字。',
                    style: text.bodySmall),
                const Divider(height: 28),
                _Row(label: '電子郵件', value: user?.email ?? '未提供'),
                _Row(
                  label: '登入方式',
                  value: auth.providerLabel(widget.profile.provider),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          '下次請用同一種方式登入。換一個供應商會被視為另一個帳號，看不到現在的任務。',
          style: text.bodySmall,
        ),
        if (_error != null) ...[
          const SizedBox(height: 16),
          Text(_error!,
              style: text.bodyMedium?.copyWith(color: AppColors.danger)),
        ],
        const SizedBox(height: 20),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('資料匯出', style: text.titleMedium),
                const SizedBox(height: 8),
                Text(
                  '匯出帳號、任務、成員、支出、付款、結算紀錄與 Base64 收據圖片。'
                  '檔案包含私人帳務資料，收據較多時可能很大。',
                  style: text.bodySmall,
                ),
                const SizedBox(height: 12),
                Builder(
                  builder: (shareContext) => OutlinedButton.icon(
                    onPressed: _exporting ? null : () => _export(shareContext),
                    icon: const Icon(Icons.download_outlined, size: 18),
                    label: Text(_exporting ? '匯出中...' : '匯出 JSON 資料'),
                  ),
                ),
                if (_exportProgress.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(_exportProgress, style: text.bodySmall),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: (_saving || !_canSubmit) ? null : _save,
          child: Text(_saving
              ? '儲存中...'
              : _saved
                  ? '已儲存'
                  : '儲存變更'),
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed: () async {
            // 先刪這台裝置的推播 token，再清 auth。反過來的話規則會擋下刪除，
            // 而留著會讓下一個在這支手機登入的人收到前一個人的旅程通知。
            final uid = ref.read(authStateProvider).value?.uid;
            await ref.read(authRepositoryProvider).signOut(
                  onBeforeSignOut: uid == null
                      ? null
                      : () => ref.read(pushRepositoryProvider).removeToken(uid),
                );
            if (context.mounted) Navigator.of(context).pop();
          },
          child: const Text('登出'),
        ),
        const SizedBox(height: 32),
        const Divider(),
        const SizedBox(height: 16),
        Text('刪除帳號', style: text.titleMedium),
        const SizedBox(height: 8),
        Text(
          '你的支出與結算會留在同行的人那裡 —— 那些帳同時也是他們的紀錄。'
          '你的帳號、個人資料與收藏會永久消失，無法復原。',
          style: text.bodySmall,
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed: _deleting ? null : _deleteAccount,
          child: Text(_deleting ? '刪除中...' : '刪除帳號'),
        ),
      ],
    );
  }
}

/// 刪除帳號的確認對話框。
///
/// `requireText` 是 null 時只要按確認；有值時要打對那串字才啟用按鈕。
/// 分級摩擦沿用 taskActionPrompt 的原則：什麼都還沒有的人不該被刁難。
class _ConfirmDeleteDialog extends StatefulWidget {
  final DeleteAccountPrompt prompt;

  const _ConfirmDeleteDialog({required this.prompt});

  @override
  State<_ConfirmDeleteDialog> createState() => _ConfirmDeleteDialogState();
}

class _ConfirmDeleteDialogState extends State<_ConfirmDeleteDialog> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final require = widget.prompt.requireText;
    final ready = require == null || _typed.text.trim() == require;

    return AlertDialog(
      title: Text(widget.prompt.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.prompt.message),
            if (require != null) ...[
              const SizedBox(height: 16),
              Text('請打出「$require」以確認：'),
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
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
          onPressed: ready ? () => Navigator.of(context).pop(true) : null,
          child: Text(widget.prompt.confirmLabel),
        ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;

  const _Row({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: text.bodySmall),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}
