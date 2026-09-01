import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/favorites.dart';
import '../domain/report.dart';
import '../state/providers.dart';
import 'report_card.dart';
import 'report_page.dart';
import 'theme.dart';

/// 探索：別人願意公開的旅程。`src/pages/ExplorePage.vue` 的 Flutter 版。
///
/// 要登入才看得到。單一份報告的連結不需要帳號（傳給誰誰就看得到），但
/// 「一次列出所有人的旅程」是另一回事 —— 那個名單只給這個 App 的使用者。
/// 規則那邊也是這樣寫的，不是只有前端擋。
class ExplorePage extends ConsumerStatefulWidget {
  const ExplorePage({super.key});

  @override
  ConsumerState<ExplorePage> createState() => _ExplorePageState();
}

class _ExplorePageState extends ConsumerState<ExplorePage> {
  String? _error;

  Future<void> _toggle(PublicReport item, bool saved) async {
    final uid = ref.read(authStateProvider).value?.uid;
    if (uid == null) return;

    setState(() => _error = null);
    try {
      final favorites = ref.read(favoriteRepositoryProvider);
      if (saved) {
        await favorites.remove(uid, item.taskId, item.report.id);
      } else {
        await favorites.add(
          uid,
          toFavorite(item.taskId, item.report.id, item.report),
        );
      }
      ref.invalidate(favoritedIdsProvider);
      ref.invalidate(favoritesProvider);
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final reports = ref.watch(publicReportsProvider);
    final saved = ref.watch(favoritedIdsProvider).value ?? const <String>{};

    return Scaffold(
      appBar: AppBar(title: const Text('探索')),
      body: reports.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _Retry(
          message: '讀取公開旅程失敗：$err',
          onRetry: () => ref.invalidate(publicReportsProvider),
        ),
        data: (list) {
          if (list.isEmpty) {
            return const _Centered(
              '目前還沒有人公開自己的旅程。'
              '你可以在自己的任務裡產生報告，再決定要不要列進這裡。',
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(publicReportsProvider);
              await ref.read(publicReportsProvider.future);
            },
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              itemCount: list.length + (_error == null ? 0 : 1),
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                if (index == list.length) {
                  return Text(
                    '收藏沒有存成功：$_error',
                    style:
                        text.bodySmall?.copyWith(color: AppColors.danger),
                  );
                }

                final item = list[index];
                final report = item.report;
                final isSaved =
                    saved.contains(favoriteId(item.taskId, report.id));

                return ReportCard(
                  taskName: report.taskName,
                  currency: report.currency,
                  startDate: report.startDate,
                  endDate: report.endDate,
                  days: report.days,
                  memberCount: report.memberCount,
                  total: report.total,
                  onOpen: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ReportPage(
                        taskId: item.taskId,
                        reportId: report.id,
                      ),
                    ),
                  ),
                  action: TextButton.icon(
                    onPressed: () => _toggle(item, isSaved),
                    icon: Icon(
                      isSaved ? Icons.favorite : Icons.favorite_border,
                      size: 18,
                    ),
                    label: Text(isSaved ? '已收藏' : '收藏'),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _Centered extends StatelessWidget {
  final String text;
  const _Centered(this.text);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(text, textAlign: TextAlign.center),
      ),
    );
  }
}

/// 讀取失敗要能重試，不用整頁重開。
class _Retry extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _Retry({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('重試')),
          ],
        ),
      ),
    );
  }
}
