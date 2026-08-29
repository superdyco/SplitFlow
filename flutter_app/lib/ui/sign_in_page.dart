import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';
import '../state/providers.dart';
import 'theme.dart';

/// 登入頁。`src/pages/LoginPage.vue` 的 Flutter 版。
///
/// 網頁版在這一頁要處理彈窗被擋、跨來源 iframe 暖機、手勢過期那一整串問題
/// （見 `data/auth_repository.dart` 的說明）。原生走系統帳號選擇器，
/// 那些全都不存在，所以這一頁就只是一顆按鈕。
class SignInPage extends ConsumerStatefulWidget {
  const SignInPage({super.key});

  @override
  ConsumerState<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends ConsumerState<SignInPage> {
  String? _error;
  bool _busy = false;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).signInWithGoogle();
    } on SignInCancelled {
      // 自己取消不是錯誤，安靜收掉就好。
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

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
                FilledButton(
                  onPressed: _busy ? null : _signIn,
                  child: Text(_busy ? 'Google 登入中...' : '使用 Google 登入'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: text.bodySmall?.copyWith(color: AppColors.danger),
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  '同一個 email 請固定用同一種方式登入。用不同供應商登入會被視為不同帳號。',
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
