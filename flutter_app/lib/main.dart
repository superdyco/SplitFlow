import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';

/// SplitFlow 原生版的進入點。
///
/// 目前只做一件事：把 Firebase 初始化起來並把結果顯示出來。這是移植過程中
/// 第一個「真的要在裝置上跑才知道對不對」的東西 —— 領域層那 146 個測試
/// 一行 Firebase 都沒碰。
///
/// 初始化刻意攤在畫面上而不是塞進 log：設定檔錯了、bundle id 對不上、
/// google-services.json 沒更新，這些都會在這裡失敗，而在手機上看 log
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

  runApp(SplitFlowApp(initError: error));
}

class SplitFlowApp extends StatelessWidget {
  final String? initError;

  const SplitFlowApp({super.key, this.initError});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SplitFlow',
      theme: ThemeData(
        // 沿用網頁版的主色（--color-primary）。整套設計語言之後再搬，
        // 先讓兩邊看起來是同一個產品。
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFE8590C)),
        useMaterial3: true,
      ),
      home: _StartupPage(error: initError),
    );
  }
}

class _StartupPage extends StatelessWidget {
  final String? error;

  const _StartupPage({this.error});

  @override
  Widget build(BuildContext context) {
    final failed = error != null;

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                failed ? 'Firebase 初始化失敗' : 'Firebase 已連上',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              Text(
                failed ? error! : '接下來要接的是任務列表與支出。',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
