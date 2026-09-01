import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/favorites.dart';
import '../state/providers.dart';
import 'confirm_dialog.dart';
import 'report_card.dart';
import 'report_page.dart';
import 'theme.dart';

/// 我的收藏。`src/pages/FavoritesPage.vue` 的 Flutter 版。
///
/// 顯示的數字是**收藏當下的快照**，不是即時的。原作者後來重新產生報告的話，
/// 這裡的總額會停在你收藏的那一刻 —— 點進去看到的才是最新版。這是刻意的：
/// 收藏頁要一次查詢就畫得完，而不是每一列各讀一次報告。
class FavoritesPage extends ConsumerStatefulWidget {
  const FavoritesPage({super.key});

  @override
  ConsumerState<FavoritesPage> createState() => _FavoritesPageState();
}

class _FavoritesPageState extends ConsumerState<FavoritesPage> {
  String? _error;

  Future<void> _remove(FavoriteReport favorite) async {
    final uid = ref.read(authStateProvider).value?.uid;
    if (uid == null) return;

    final ok = await showConfirmDialog(
      context,
      title: '移除這份收藏？',
      message: '只會從你的收藏移除，原本的旅程不受影響。之後還是可以再收藏一次。',
      confirmLabel: '移除',
      destructive: true,
    );
    if (!ok) return;

    setState(() => _error = null);
    try {
      await ref
          .read(favoriteRepositoryProvider)
          .remove(uid, favorite.taskId, favorite.reportId);
      ref.invalidate(favoritesProvider);
      ref.invalidate(favoritedIdsProvider);
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final favorites = ref.watch(favoritesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('我的收藏')),
      body: favorites.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _Retry(
          message: '讀取收藏失敗：$err',
          onRetry: () => ref.invalidate(favoritesProvider),
        ),
        data: (list) {
          if (list.isEmpty) {
            return const _Centered(
              '還沒有收藏。在「探索」或別人傳來的報告頁按下收藏，就會出現在這裡。',
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            itemCount: list.length + (_error == null ? 0 : 1),
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              if (index == list.length) {
                return Text(
                  '移除失敗：$_error',
                  style: text.bodySmall?.copyWith(color: AppColors.danger),
                );
              }

              final favorite = list[index];
              return ReportCard(
                taskName: favorite.taskName,
                currency: favorite.currency,
                startDate: favorite.startDate,
                endDate: favorite.endDate,
                days: favorite.days,
                memberCount: favorite.memberCount,
                total: favorite.total,
                onOpen: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ReportPage(
                      taskId: favorite.taskId,
                      reportId: favorite.reportId,
                    ),
                  ),
                ),
                action: TextButton.icon(
                  onPressed: () => _remove(favorite),
                  icon: const Icon(Icons.delete_outline, size: 18),
                  label: const Text('移除'),
                ),
              );
            },
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
