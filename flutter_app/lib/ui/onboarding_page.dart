import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/validation.dart' as validate;
import '../state/providers.dart';
import 'theme.dart';

/// 第一次登入時取暱稱。`src/pages/OnboardingPage.vue` 的 Flutter 版。
///
/// **這一頁不是可有可無的裝飾，少了它新使用者會卡死。** 登入只建立 Firebase
/// 的帳號，`users/{uid}` 那份文件是這裡才寫進去的；沒有它，建立任務會失敗、
/// 加入任務也沒有名字可以顯示，而唯一能改暱稱的個人設定頁又要求先有那份文件。
///
/// 所以進入條件是「登入了、但還沒有暱稱」，而且**沒有跳過的選項** ——
/// 跳過就回到那個死結。
class OnboardingPage extends ConsumerStatefulWidget {
  final User user;

  const OnboardingPage({super.key, required this.user});

  @override
  ConsumerState<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends ConsumerState<OnboardingPage> {
  late final TextEditingController _nickname;

  bool _touched = false;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Google 帳號的顯示名稱當預設值：多數人就是用這個名字，
    // 讓他直接按下一步比逼他從空白開始打好。
    _nickname = TextEditingController(text: widget.user.displayName ?? '');
  }

  @override
  void dispose() {
    _nickname.dispose();
    super.dispose();
  }

  String? get _nicknameError =>
      validate.textFieldError(_nickname.text, '暱稱', max: 20, touched: _touched);

  bool get _canSubmit =>
      _nickname.text.trim().isNotEmpty && _nicknameError == null;

  Future<void> _save() async {
    setState(() => _touched = true);
    if (!_canSubmit) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(userRepositoryProvider).createProfile(
            widget.user,
            validate.required(_nickname.text, '暱稱'),
          );
      // 作廢之後 _Root 會重新讀到有暱稱的資料，自己換到任務列表。
      // 這裡不做導頁 —— 判斷「該看哪一頁」的規則只放一個地方。
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

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final initial = _nickname.text.trim().isEmpty
        ? '?'
        : _nickname.text.trim().characters.first.toUpperCase();

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 32),
          children: [
            Text('第一次使用', style: text.bodySmall),
            const SizedBox(height: 8),
            Text('取一個暱稱', style: text.headlineSmall),
            const SizedBox(height: 8),
            Text(
              '其他成員會在帳目與成員列表看到這個名字，之後可以在個人設定修改。',
              style: text.bodyMedium,
            ),
            const SizedBox(height: 24),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: AppColors.primarySoft,
                      child: Text(
                        initial,
                        style: const TextStyle(
                          color: AppColors.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _nickname,
                        autofocus: true,
                        maxLength: 20,
                        decoration: const InputDecoration(
                          hintText: '輸入暱稱',
                          counterText: '',
                        ),
                        // 邊打邊更新那顆頭像的第一個字。
                        onChanged: (_) => setState(() {}),
                        onTapOutside: (_) => setState(() => _touched = true),
                        onSubmitted: (_) => _save(),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_nicknameError != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(_nicknameError!,
                    style: text.bodySmall?.copyWith(color: AppColors.danger)),
              ),
            const SizedBox(height: 10),
            Text('已用 Google 登入 · ${widget.user.email ?? ''}',
                style: text.bodySmall),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!,
                  style: text.bodyMedium?.copyWith(color: AppColors.danger)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: (_saving || !_canSubmit) ? null : _save,
              child: Text(_saving ? '儲存中...' : '建立帳號'),
            ),
            const SizedBox(height: 12),
            // 沒有「跳過」，但要有出路：登錯帳號的人不該被關在這一頁。
            TextButton(
              onPressed: _saving
                  ? null
                  : () => ref.read(authRepositoryProvider).signOut(),
              child: const Text('用別的帳號登入'),
            ),
          ],
        ),
      ),
    );
  }
}
