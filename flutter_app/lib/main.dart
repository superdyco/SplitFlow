import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'firebase_options.dart';
import 'state/pending_task.dart';
import 'state/providers.dart';
import 'ui/onboarding_page.dart';
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

  // App 完全關閉時點通知，訊息會在這裡拿到 —— 之後的 onMessageOpenedApp
  // 不會再送一次，所以兩個都要接。
  String? pendingTaskId;
  if (error == null) {
    try {
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      pendingTaskId = initial?.data['taskId'] as String?;
    } catch (_) {
      // 沒有 Google Play 服務的裝置這裡會丟。收不到通知不該讓 App 開不起來。
    }
  }

  runApp(
    ProviderScope(
      overrides: [
        if (pendingTaskId != null)
          pendingTaskIdProvider.overrideWith((ref) => pendingTaskId),
      ],
      child: SplitFlowApp(initError: error),
    ),
  );
}

class SplitFlowApp extends StatelessWidget {
  final String? initError;

  const SplitFlowApp({super.key, this.initError});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '簡單分帳',
      theme: buildAppTheme(),
      home: initError != null ? _FatalPage(message: initError!) : const _Root(),
    );
  }
}

/// 該看哪一頁。**判斷只放在這裡一個地方。**
///
/// 三種狀態，順序有意義：
///
///   1. 沒登入 → 登入頁
///   2. 登入了但還沒有暱稱 → 取暱稱（`users/{uid}` 是那一頁寫進去的）
///   3. 都有了 → 任務列表
///
/// 第 2 種不能跳過。登入只建立 Firebase 帳號，沒有那份使用者文件的話，
/// 建立任務會失敗、加入任務也沒有名字可顯示 —— 而唯一能設暱稱的個人設定頁
/// 又要求先有那份文件，是個死結。
///
/// 用 stream 而不是一次性讀取：Firebase 還原登入狀態是非同步的，開 App 當下
/// `currentUser` 可能還是 null，等一下才變成使用者。只看第一眼的話，
/// 已登入的人會先閃一下登入頁。
class _Root extends ConsumerStatefulWidget {
  const _Root();

  @override
  ConsumerState<_Root> createState() => _RootState();
}

class _RootState extends ConsumerState<_Root> {
  StreamSubscription<RemoteMessage>? _opened;
  StreamSubscription<String>? _refreshed;

  @override
  void initState() {
    super.initState();

    // App 還活著但在背景時點通知走這條。完全關閉那條在 main() 的
    // getInitialMessage —— 兩條都要接，它們不會互相補位。
    _opened = FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final taskId = message.data['taskId'] as String?;
      if (taskId != null) {
        ref.read(pendingTaskIdProvider.notifier).state = taskId;
      }
    });

    // token 會自己輪替。不接的話換發之後伺服器手上那份就是死的，
    // 而使用者完全不會察覺 —— 只是再也收不到通知。
    _refreshed = ref.read(pushRepositoryProvider).onTokenRefresh().listen((_) {
      final uid = ref.read(authStateProvider).value?.uid;
      if (uid != null) ref.read(pushRepositoryProvider).registerToken(uid);
    });
  }

  @override
  void dispose() {
    _opened?.cancel();
    _refreshed?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);

    return auth.when(
      loading: () => const _Waiting(),
      error: (err, _) => _FatalPage(message: '登入狀態讀取失敗：$err'),
      data: (user) {
        if (user == null) return const SignInPage();

        final profile = ref.watch(userProfileProvider);
        return profile.when(
          // 讀資料的空檔不要先閃一下取暱稱頁 —— 那會讓每次開 App 都像
          // 第一次使用。
          loading: () => const _Waiting(),
          // 讀不到就當作還沒設定：真的沒有的話這一頁正好；只是網路不好的話，
          // 存的時候用的是 merge，不會洗掉既有資料。
          error: (err, _) => OnboardingPage(user: user),
          data: (value) => (value == null || value.nickname.trim().isEmpty)
              ? OnboardingPage(user: user)
              : const TaskListPage(),
        );
      },
    );
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
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
