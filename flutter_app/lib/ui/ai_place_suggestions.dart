/// AI 讀完收據之後的「是不是這家？」。
/// `src/components/expense/AiPlaceSuggestions.vue` 的 Flutter 版。
///
/// 用店名＋地址搜一次，列出最多 3 家，**點了才算數**。不自動選第一個：連鎖店
/// 同一個名字附近有好幾家，選錯的地點會出現在公開報告的地圖上，而使用者不一定
/// 會發現。
///
/// 搜尋與位置偏好跟 `PlaceField` 用同一組服務，所以結果跟自己在地點欄位打字一樣；
/// autocomplete 與 details 共用 session token，算一次計費。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/error_text.dart';
import '../data/place_service.dart';
import '../domain/models.dart';
import '../domain/place_search.dart';
import '../state/providers.dart';
import 'theme.dart';

class AiPlaceSuggestions extends ConsumerStatefulWidget {
  final String query;
  final String taskId;
  final ValueChanged<ExpensePlace> onPick;
  final VoidCallback onDismiss;

  const AiPlaceSuggestions({
    super.key,
    required this.query,
    required this.taskId,
    required this.onPick,
    required this.onDismiss,
  });

  @override
  ConsumerState<AiPlaceSuggestions> createState() => _AiPlaceSuggestionsState();
}

class _AiPlaceSuggestionsState extends ConsumerState<AiPlaceSuggestions> {
  /// 三家就夠挑了。再多就變成一份清單，那是地點欄位本來就做得到的事。
  static const _max = 3;

  List<PlaceSuggestion> _suggestions = const [];
  bool _loading = false;
  String? _error;
  String _session = newSessionToken();

  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void didUpdateWidget(AiPlaceSuggestions oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 同一張收據重按一次 AI、店名或地址變了，就重查。舊的 session 沒選就作廢。
    if (oldWidget.query != widget.query) {
      _session = newSessionToken();
      _search();
    }
  }

  Future<void> _search() async {
    if (!PlaceService.placesEnabled) return;
    setState(() {
      _loading = true;
      _error = null;
      _suggestions = const [];
    });
    try {
      final bias = await ref.read(biasStoreProvider).recall(widget.taskId);
      final found = await ref
          .read(placeServiceProvider)
          .autocomplete(widget.query, _session, bias: bias);
      if (mounted) setState(() => _suggestions = found.take(_max).toList());
    } catch (err) {
      if (mounted) setState(() => _error = errorText(err));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pick(PlaceSuggestion suggestion) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail =
          await ref.read(placeServiceProvider).details(suggestion.placeId, _session);
      _session = newSessionToken();
      // 這個任務接下來的搜尋就以這裡為中心，跟在地點欄位裡選的一樣。
      await ref.read(biasStoreProvider).remember(widget.taskId, detail);
      if (!mounted) return;
      widget.onPick(detail);
    } catch (err) {
      if (mounted) setState(() => _error = errorText(err));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // 沒有地點金鑰、或查完什麼都沒有，整塊不出現。地點欄位照樣可以自己打。
    if (!PlaceService.placesEnabled) return const SizedBox.shrink();
    if (!_loading && _error == null && _suggestions.isEmpty) {
      return const SizedBox.shrink();
    }

    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('是不是這家？點一下才會填進地點。', style: text.bodySmall),
        const SizedBox(height: AppSpace.x2),
        if (_loading && _suggestions.isEmpty)
          Text('找地點中…', style: text.bodySmall),
        for (final item in _suggestions) ...[
          OutlinedButton(
            style: OutlinedButton.styleFrom(
              alignment: Alignment.centerLeft,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpace.x3,
                vertical: AppSpace.x2,
              ),
            ),
            onPressed: _loading ? null : () => _pick(item),
            // 店名一行、地址一行，左對齊 —— 兩行字置中很難讀。
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  item.primary,
                  style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                ),
                if (item.secondary.isNotEmpty)
                  Text(item.secondary, style: text.bodySmall),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
        if (_error != null)
          Text(_error!, style: text.bodySmall?.copyWith(color: AppColors.danger)),
        if (_suggestions.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _loading ? null : widget.onDismiss,
              child: const Text('都不是'),
            ),
          ),
      ],
    );
  }
}
