import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'firebase_options.dart';
import 'state/providers.dart';
import 'ui/sign_in_page.dart';
import 'ui/task_list_page.dart';
import 'ui/theme.dart';

/// SplitFlow 原生版的進入點。
///
/// Firebase 初始化的失敗攤在畫面上而不是塞進 log：設定檔錯了、bundle id
/// 對不上、google-services.json 沒更新，這些都會在這裡失敗，而在手機上看 log
/// 遠比看一行字麻煩。
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  String? error;
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (err) {
    error = err.toString();
  }

  runApp(ProviderScope(child: SplitFlowApp(initError: error)));
}

class SplitFlowApp extends StatelessWidget {
  final String? initError;

  const SplitFlowApp({super.key, this.initError});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SplitFlow',
      theme: buildAppTheme(),
      home: initError != null ? _FatalPage(message: initError!) : const _Root(),
    );
  }
}

/// 登入狀態決定看到哪一頁。
///
/// 用 stream 而不是一次性讀取：Firebase 還原登入狀態是非同步的，開 App 當下
/// `currentUser` 可能還是 null，等一下才變成使用者。只看第一眼的話，
/// 已登入的人會先閃一下登入頁。
class _Root extends ConsumerWidget {
  const _Root();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    return auth.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (err, _) => _FatalPage(message: '登入狀態讀取失敗：$err'),
      data: (user) => user == null ? const SignInPage() : const TaskListPage(),
    );
  }
}

class _FatalPage extends StatelessWidget {
  final String message;
  const _FatalPage({required this.message});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('啟動失敗', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
