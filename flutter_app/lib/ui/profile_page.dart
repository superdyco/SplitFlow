import 'package:firebase_auth/firebase_auth.dart' show AuthCredential;
// defaultTargetPlatform 在 foundation，material 不轉出它。
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';
import '../domain/account_deletion.dart';
import '../domain/ai_receipt.dart';
import '../domain/auth_error.dart' as auth;
import '../domain/models.dart';
import '../domain/validation.dart' as validate;
import '../state/pending_guest_merge.dart';
import '../state/providers.dart';
import 'confirm_dialog.dart';
import 'diagnostics_section.dart';
import 'system_share.dart';
import 'ledger.dart';
import 'theme.dart';
import '../data/error_text.dart';

/// 個人設定。`src/pages/ProfilePage.vue` 的 Flutter 版。
///
/// 診斷資訊在 `diagnostics_section.dart`，預設收起。收藏與探索的入口在
/// 「我的分帳」的標題列 —— 那是別人的旅程，跟這一頁的「我的帳號」不同類。
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
            child: Text('讀取個人資料失敗：${errorText(err)}', textAlign: TextAlign.center),
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
  auth.SignInProvider? _linking;
  bool _merging = false;

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

    // 刪除帳號永遠是破壞性的 —— 沒有任務的人不必打字，但那不代表後果比較輕。
    final confirmed = await showConfirmDialog(
      context,
      title: prompt.title,
      message: prompt.message,
      confirmLabel: prompt.confirmLabel,
      requireText: prompt.requireText,
      destructive: true,
    );
    if (!confirmed || !mounted) return;

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
      if (mounted) setState(() => _error = errorText(err));
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  Future<void> _bind(auth.SignInProvider provider) async {
    setState(() {
      _linking = provider;
      _error = null;
    });
    try {
      final repo = ref.read(authRepositoryProvider);
      final outcome = provider == auth.SignInProvider.apple
          ? await repo.linkWithApple()
          : await repo.linkWithGoogle();
      switch (outcome) {
        case Linked(:final user):
          await ref.read(userRepositoryProvider).updateProviderFields(user);
          // uid 沒變，authStateChanges 不會再響 —— 手動作廢，畫面才看得到
          // isAnonymous 已經變了。
          ref.invalidate(authStateProvider);
          ref.invalidate(userProfileProvider);
        case AccountTaken(:final credential):
          await _offerMerge(credential);
      }
    } on SignInCancelled {
      // 自己取消不是錯誤。
    } catch (err) {
      if (mounted) setState(() => _error = errorText(err));
    } finally {
      if (mounted) setState(() => _linking = null);
    }
  }

  Future<void> _offerMerge(AuthCredential credential) async {
    final tasks = ref.read(tasksProvider).value ?? const <Task>[];
    final ok = await showConfirmDialog(
      context,
      title: '這個帳號已經有資料',
      message: '要把訪客的 ${tasks.length} 個任務合併進去嗎？'
          '合併後這台手機會改用那個帳號，訪客身分會消失。'
          '如果那個帳號也在同一個任務裡，訪客記的帳會變成一位「（訪客）」成員，金額不變。',
      confirmLabel: '合併',
    );
    if (!ok || !mounted) return;

    // 換帳號的那一刻 authStateChanges 會響，這一頁整個重建、這個 State 會被丟掉 ——
    // 之後要用的東西全部先拿好，await 之後不能再 ref.read。
    final repo = ref.read(authRepositoryProvider);
    final pending = ref.read(pendingGuestMergeProvider.notifier);
    final navigator = Navigator.of(context);

    setState(() => _merging = true);
    try {
      // 順序不能換：換到正式帳號之後就再也拿不到訪客的證明了。
      final token = await repo.guestIdToken();
      await repo.switchToAccount(credential);
      if (await runGuestMerge(repo, pending, token)) {
        navigator.popUntil((route) => route.isFirst);
      }
    } catch (err) {
      if (mounted) setState(() => _error = errorText(err));
    } finally {
      if (mounted) setState(() => _merging = false);
    }
  }

  Future<void> _retryMerge(String guestToken) async {
    final repo = ref.read(authRepositoryProvider);
    final pending = ref.read(pendingGuestMergeProvider.notifier);
    final navigator = Navigator.of(context);

    setState(() => _merging = true);
    final ok = await runGuestMerge(repo, pending, guestToken);
    if (mounted) setState(() => _merging = false);
    if (ok) navigator.popUntil((route) => route.isFirst);
  }

  /// 訪客的登出＝刪除訪客帳號。他沒有任何方式能再登入回來，與其留一個再也不會
  /// 出現的成員掛在別人的任務裡，不如走 deleteAccount：owner 身分移交、只有他
  /// 一個真人的任務刪掉、別人的任務裡標成已刪除。
  Future<void> _guestSignOut() async {
    final confirmed = await showConfirmDialog(
      context,
      title: '訪客登出後就回不來了',
      message: '訪客沒有帳號可以再登入回來。登出會刪除這個訪客身分：'
          '只有你一個人的任務會一起刪掉，別人的任務裡你會顯示為已刪除。'
          '想留著資料，請先在上面綁定帳號。',
      confirmLabel: '仍要登出',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    final navigator = Navigator.of(context);
    try {
      await ref.read(authRepositoryProvider).deleteAccount();
      navigator.pop();
    } catch (err) {
      if (mounted) setState(() => _error = errorText(err));
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
          _error = errorText(err);
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
      if (mounted) setState(() => _error = '匯出失敗：${errorText(err)}');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final user = ref.watch(authStateProvider).value;
    final guest = user?.isAnonymous ?? false;
    final pendingMerge = ref.watch(pendingGuestMergeProvider);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        LedgerCard(
          children: [
            const LedgerStrip(title: '個人資料'),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.x4,
                AppSpace.x4,
                AppSpace.x4,
                AppSpace.x3,
              ),
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
                    Text(
                      _nicknameError!,
                      style: text.bodySmall?.copyWith(color: AppColors.danger),
                    ),
                  const SizedBox(height: AppSpace.x2),
                  Text(
                    '同行的人在支出與結算上看到的就是這個名字。',
                    style: text.bodySmall,
                  ),
                ],
              ),
            ),
            const LedgerDivider(indent: 0),
            // 唯讀的兩項用 LedgerRow：左標籤右值，跟任務頁的列同一個形狀。
            if (!guest) ...[
              LedgerRow(
                title: '電子郵件',
                trailing: Text(user?.email ?? '未提供', style: text.bodyMedium),
              ),
              const LedgerDivider(),
            ],
            LedgerRow(
              title: '登入方式',
              trailing: Text(
                auth.providerLabel(widget.profile.provider),
                style: text.bodyMedium,
              ),
            ),
            if (!guest) ...[
              const LedgerDivider(),
              LedgerRow(
                title: 'AI 辨識點數',
                trailing: Text(
                  ref.watch(aiCreditsProvider).when(
                        // null 是還沒用過：第一次辨識時會拿到 3 點。
                        data: (value) => '${value ?? freeCredits}',
                        loading: () => '…',
                        error: (_, __) => '—',
                      ),
                  style: text.bodyMedium,
                ),
              ),
            ],
          ],
        ),
        if (!guest) ...[
          const SizedBox(height: 12),
          Text(
            '下次請用同一種方式登入。換一個供應商會被視為另一個帳號，看不到現在的任務。',
            style: text.bodySmall,
          ),
        ],
        if (guest) ...[
          const SizedBox(height: 20),
          LedgerCard(
            children: [
              const LedgerStrip(title: '綁定帳號'),
              Padding(
                padding: const EdgeInsets.all(AppSpace.x4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '你目前是訪客，資料只存在這台手機 —— 刪掉 App 就找不回來。'
                      '綁定之後，任務都會留著。',
                      style: text.bodySmall,
                    ),
                    const SizedBox(height: AppSpace.x3),
                    for (final provider in auth.enabledProvidersFor(
                      isApplePlatform: defaultTargetPlatform == TargetPlatform.iOS,
                    )) ...[
                      OutlinedButton(
                        onPressed: (_linking == null && !_merging)
                            ? () => _bind(provider)
                            : null,
                        child: Text(
                          _linking == provider
                              ? '${auth.providerLabels[provider]} 綁定中...'
                              : '使用 ${auth.providerLabels[provider]} 綁定',
                        ),
                      ),
                      const SizedBox(height: AppSpace.x2),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ],
        // 不看 guest：走到這裡時使用者已經換成正式帳號了。
        if (pendingMerge != null) ...[
          const SizedBox(height: 20),
          LedgerCard(
            children: [
              const LedgerStrip(title: '合併沒有完成'),
              Padding(
                padding: const EdgeInsets.all(AppSpace.x4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '你已經換到正式帳號了，但訪客的任務還沒搬過來。一小時內都可以重試。',
                      style: text.bodySmall,
                    ),
                    if (pendingMerge.error != null) ...[
                      const SizedBox(height: AppSpace.x2),
                      Text(
                        pendingMerge.error!,
                        style: text.bodySmall?.copyWith(color: AppColors.danger),
                      ),
                    ],
                    const SizedBox(height: AppSpace.x3),
                    FilledButton(
                      onPressed: _merging
                          ? null
                          : () => _retryMerge(pendingMerge.guestToken),
                      child: Text(_merging ? '合併中...' : '重試合併'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 16),
          Text(_error!,
              style: text.bodyMedium?.copyWith(color: AppColors.danger)),
        ],
        const SizedBox(height: 20),
        LedgerCard(
          children: [
            const LedgerStrip(title: '資料匯出'),
            Padding(
              padding: const EdgeInsets.all(AppSpace.x4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
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
          ],
        ),
        const SizedBox(height: 12),
        // 排在資料匯出之後、儲存之前：這一區是「出問題時才看」的東西，
        // 不該擋在使用者真正來這一頁要做的事前面。
        DiagnosticsSection(provider: widget.profile.provider),
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
            if (guest) {
              await _guestSignOut();
              return;
            }
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
        // 不可逆的動作也給一張卡。原本它靠一條 Divider 跟上面隔開，
        // 那條線跟卡片裡的分隔線長得一樣 —— 分區跟分列用同一個記號，
        // 就等於沒有分區。
        LedgerCard(
          children: [
            const LedgerStrip(title: '刪除帳號'),
            Padding(
              padding: const EdgeInsets.all(AppSpace.x4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '你的支出與結算會留在同行的人那裡 —— 那些帳同時也是他們的紀錄。'
                    '你的帳號、個人資料與收藏會永久消失，無法復原。',
                    style: text.bodySmall,
                  ),
                  const SizedBox(height: AppSpace.x3),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                    ),
                    onPressed: _deleting ? null : _deleteAccount,
                    child: Text(_deleting ? '刪除中...' : '刪除帳號'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}


