import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';
import '../domain/auth_error.dart';
import '../state/providers.dart';
import 'theme.dart';

/// 登入頁。`src/pages/LoginPage.vue` 的 Flutter 版。
///
/// 網頁版在這一頁要處理彈窗被擋、跨來源 iframe 暖機、手勢過期那一整串問題
/// （見 `data/auth_repository.dart` 的說明）。原生走系統的授權畫面，
/// 那些全都不存在。
///
/// 按鈕從 `enabledProvidersFor` 產生而不是寫死：Apple 只在 iOS 出現，
/// 而那份清單本來就是決定「開哪些登入方式」的唯一地方。
class SignInPage extends ConsumerStatefulWidget {
  const SignInPage({super.key});

  @override
  ConsumerState<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends ConsumerState<SignInPage> {
  String? _error;

  /// 哪一個供應商正在登入中。用 null 表示閒置 —— 記下是「哪一個」而不是
  /// 「有沒有」，才能只在被按的那顆按鈕上顯示進行中，其餘只是停用。
  SignInProvider? _busy;

  Future<void> _signIn(SignInProvider provider) async {
    setState(() {
      _busy = provider;
      _error = null;
    });
    try {
      final auth = ref.read(authRepositoryProvider);
      switch (provider) {
        case SignInProvider.google:
          await auth.signInWithGoogle();
        case SignInProvider.apple:
          await auth.signInWithApple();
        case SignInProvider.facebook:
          throw UnimplementedError('Facebook 登入沒有開啟');
      }
    } on SignInCancelled {
      // 自己取消不是錯誤，安靜收掉就好。
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final providers = enabledProvidersFor(
      isApplePlatform: defaultTargetPlatform == TargetPlatform.iOS,
    );

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(22),
                  child: Image.asset(
                    'assets/brand/app-logo.png',
                    width: 64,
                    height: 64,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: 24),
                Text('一趟旅行\n一份帳單', style: text.headlineSmall),
                const SizedBox(height: 12),
                Text(
                  '登入簡單分帳，建立任務、邀請同行成員，記帳與結算都用真實資料。'
                  '之後會請你取一個同行的人看得到的暱稱。',
                  style: text.bodyMedium?.copyWith(color: AppColors.muted),
                ),
                const SizedBox(height: 28),
                for (final provider in providers) ...[
                  _ProviderButton(
                    provider: provider,
                    busy: _busy == provider,
                    // 登入中就把所有按鈕都停用，不然可以同時開兩個授權流程。
                    onPressed: _busy == null ? () => _signIn(provider) : null,
                  ),
                  const SizedBox(height: 12),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    _error!,
                    style: text.bodySmall?.copyWith(color: AppColors.danger),
                  ),
                ],
                const SizedBox(height: 4),
                Text(
                  '同一個 email 請固定用同一種方式登入，換一個供應商會被視為不同帳號。'
                  'Apple 登入若選擇「隱藏我的電子郵件」，拿到的是一組轉發位址，'
                  '那也會是一個全新的帳號，看不到你原本的任務。',
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 一顆登入按鈕。
///
/// Apple 那顆刻意走 Apple 自己的視覺規範（黑底、白字、蘋果標誌）而不是套用
/// App 的主色：那是人機介面指引的要求，而審查員會實際看畫面。其餘供應商用
/// App 的一般按鈕樣式就好。
class _ProviderButton extends StatelessWidget {
  final SignInProvider provider;
  final bool busy;
  final VoidCallback? onPressed;

  const _ProviderButton({
    required this.provider,
    required this.busy,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final label = providerLabels[provider] ?? '';

    if (provider == SignInProvider.apple) {
      return FilledButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.apple, size: 20),
        label: Text(busy ? '登入中...' : '透過 Apple 登入'),
        style: FilledButton.styleFrom(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          disabledBackgroundColor: Colors.black45,
          disabledForegroundColor: Colors.white70,
        ),
      );
    }

    return FilledButton(
      onPressed: onPressed,
      child: Text(busy ? '$label 登入中...' : '使用 $label 登入'),
    );
  }
}
