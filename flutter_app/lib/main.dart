import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'data/auth_repository.dart';
import 'domain/currency.dart';
import 'domain/models.dart';
import 'domain/task_status.dart';
import 'firebase_options.dart';
import 'state/providers.dart';

/// SplitFlow 原生版的進入點。
///
/// ⚠️ **目前這是一個驗證用的畫面，不是產品。**
///
/// 它存在的唯一理由是把資料層跑起來對數字：登入 → 讀任務 → 算結算，
/// 然後拿這些數字跟網頁版比。那一層有 700 行從來沒被執行過，先確認它對，
/// 再往上疊真正的畫面 —— 不然出錯時要在資料層、狀態層、UI 三層之間找原因。
///
/// 對完數字之後這個檔案會被真正的路由與畫面取代。
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
      theme: ThemeData(
        // 沿用網頁版的主色（--color-primary）。整套設計語言之後再搬。
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFE8590C)),
        useMaterial3: true,
      ),
      home: initError != null
          ? _FatalPage(message: initError!)
          : const _VerifyPage(),
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
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Firebase 初始化失敗'),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}

/// 登入 → 列任務 → 每個任務算一次結算，把數字攤出來。
class _VerifyPage extends ConsumerWidget {
  const _VerifyPage();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('資料層驗證'),
        actions: [
          if (auth.value != null)
            IconButton(
              icon: const Icon(Icons.logout),
              onPressed: () => ref.read(authRepositoryProvider).signOut(),
            ),
        ],
      ),
      body: auth.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _Message('登入狀態讀取失敗：$err'),
        data: (user) => user == null ? const _SignIn() : const _Tasks(),
      ),
    );
  }
}

class _SignIn extends ConsumerStatefulWidget {
  const _SignIn();

  @override
  ConsumerState<_SignIn> createState() => _SignInState();
}

class _SignInState extends ConsumerState<_SignIn> {
  String? error;
  bool busy = false;

  Future<void> _signIn() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref.read(authRepositoryProvider).signInWithGoogle();
    } on SignInCancelled {
      // 使用者自己取消，不是錯誤。
    } catch (err) {
      setState(() => error = err.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Firebase 已連上'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy ? null : _signIn,
              child: Text(busy ? '登入中...' : '以 Google 登入'),
            ),
            if (error != null) ...[
              const SizedBox(height: 16),
              Text(error!, textAlign: TextAlign.center),
            ],
          ],
        ),
      ),
    );
  }
}

class _Tasks extends ConsumerWidget {
  const _Tasks();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(tasksProvider);

    return tasks.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _Message('讀取任務失敗：$err'),
      data: (all) {
        // 已刪除的一律不出現 —— 走跟網頁版同一支 partitionTasks。
        final parts = partitionTasks(all, (t) => taskStatusFrom(t.status));
        final visible = [...parts.active, ...parts.archived];

        if (visible.isEmpty) return const _Message('讀到 0 個任務。');

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('讀到 ${visible.length} 個任務'
                '（進行中 ${parts.active.length}、封存 ${parts.archived.length}）'),
            const SizedBox(height: 8),
            for (final task in visible) _TaskCard(task: task),
          ],
        );
      },
    );
  }
}

class _TaskCard extends ConsumerWidget {
  final Task task;
  const _TaskCard({required this.task});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settlement = ref.watch(settlementProvider(task.id));

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(task.name,
                style: Theme.of(context).textTheme.titleMedium),
            Text('${task.defaultCurrency} · ${task.memberCount} 人 · '
                '${task.expenseCount} 筆 · ${task.status}'),
            const SizedBox(height: 8),
            settlement.when(
              loading: () => const Text('計算中...'),
              error: (err, _) => Text('算不出來：$err'),
              data: (result) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('總額 ${result.currency} '
                      '${formatAmount(result.total, result.currency)}'),
                  Text('列入 ${result.expenseCount} 筆'
                      '${result.unconverted.isEmpty ? '' : '（${result.unconverted.length} 筆缺匯率）'}'),
                  Text('建議轉帳 ${result.transfers.length} 筆'),
                  // 不變條件：加總不是 0 就是算錯了，要立刻看得出來。
                  Text('balance 加總 '
                      '${result.balances.fold<int>(0, (a, b) => a + b.balance)}'
                      '（必須是 0）'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  final String text;
  const _Message(this.text);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(text, textAlign: TextAlign.center),
      ),
    );
  }
}
