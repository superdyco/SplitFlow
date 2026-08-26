import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/place_service.dart';
import '../domain/models.dart';
import '../domain/place_bias.dart';
import '../domain/place_search.dart';
import '../state/providers.dart';
import 'theme.dart';

/// 地點欄位。`ExpenseFormPage.vue` 裡地點那一段的 Flutter 版。
///
/// 打字給建議、選一個就把座標一起帶上。沒設定金鑰時退化成純文字輸入 ——
/// 跟網頁版一樣，功能不會壞掉，只是少了建議。
///
/// 呼叫端拿到的永遠是「現在這一格代表的地點」：選過建議就是完整的那一份
/// （含座標），只打了名字就是只有 name 的那一份，空的就是 null。
class PlaceField extends ConsumerStatefulWidget {
  final String taskId;

  /// 編輯既有支出時帶進來的地點。
  final ExpensePlace? initial;

  final ValueChanged<ExpensePlace?> onChanged;

  const PlaceField({
    super.key,
    required this.taskId,
    required this.initial,
    required this.onChanged,
  });

  @override
  ConsumerState<PlaceField> createState() => _PlaceFieldState();
}

class _PlaceFieldState extends ConsumerState<PlaceField> {
  late final TextEditingController _query;

  /// 從建議選出來的那一份，含座標。使用者一改字就作廢 —— 改過的名字
  /// 已經不是這個地點了。
  ExpensePlace? _selected;

  List<PlaceSuggestion> _suggestions = const [];
  LatLng? _bias;
  Timer? _debounce;
  String _session = newSessionToken();

  bool _loading = false;
  String? _error;

  bool get _searchable => PlaceService.placesEnabled;

  @override
  void initState() {
    super.initState();
    // 編輯既有支出時，一開始就把原本那份當成「已選取」。
    //
    // 這不只是方便：網頁版選過的地點存了座標，原生版如果只留名字，
    // 使用者改個金額按儲存，那些座標就沒了 —— 地圖跟報告都會少一個點。
    _selected = widget.initial;
    _query = TextEditingController(text: widget.initial?.name ?? '');
    _loadBias();
  }

  Future<void> _loadBias() async {
    final bias = await ref.read(biasStoreProvider).recall(widget.taskId);
    if (mounted && bias != null) setState(() => _bias = bias);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  /// 這一格現在代表的地點。
  ///
  /// 名字跟選取的那一份對得起來才算數 —— 選完再改字的話，剩下的就只是文字。
  ExpensePlace? get _value {
    final text = _query.text.trim();
    if (text.isEmpty) return null;
    final selected = _selected;
    if (selected != null && selected.name == text) return selected;
    return ExpensePlace(name: text);
  }

  void _emit() => widget.onChanged(_value);

  void _onInput(String value) {
    setState(() {
      _selected = null;
      _error = null;
    });
    _emit();
    if (!_searchable) return;

    _debounce?.cancel();
    // 一個字太短，回傳的東西沒有參考價值，還要花一次錢。
    if (value.trim().length < 2) {
      setState(() => _suggestions = const []);
      return;
    }
    // 每打一個字就打一次 API 太浪費，等使用者停下來再查。
    _debounce = Timer(const Duration(milliseconds: 350), _search);
  }

  Future<void> _search() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(placeServiceProvider)
          .autocomplete(_query.text, _session, bias: _bias);
      if (mounted) setState(() => _suggestions = result);
    } catch (err) {
      if (mounted) {
        setState(() {
          _suggestions = const [];
          _error = err.toString();
        });
      }
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
      if (!mounted) return;
      setState(() {
        _selected = detail;
        _query.text = detail.name;
        _suggestions = const [];
        // 這個任務接下來的搜尋就以這裡為中心。
        _bias = biasFromPlaces([detail]) ?? _bias;
        // 一次 autocomplete + details 算一個 session，選完就換新的。
        _session = newSessionToken();
      });
      _emit();
      await ref.read(biasStoreProvider).remember(widget.taskId, detail);
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _clear() {
    _debounce?.cancel();
    setState(() {
      _query.clear();
      _selected = null;
      _suggestions = const [];
      _error = null;
    });
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final selected = _selected;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _query,
          onChanged: _onInput,
          decoration: InputDecoration(
            hintText: _searchable ? '打兩個字以上開始搜尋' : null,
            suffixIcon: _loading
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : (_query.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: '清除',
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: _clear,
                      )),
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(_error!,
                style: text.bodySmall?.copyWith(color: AppColors.danger)),
          ),
        if (_suggestions.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 6),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.line),
            ),
            child: Column(
              children: [
                for (final item in _suggestions)
                  ListTile(
                    dense: true,
                    title: Text(item.primary, style: text.bodyMedium),
                    subtitle: item.secondary.isEmpty
                        ? null
                        : Text(item.secondary, style: text.bodySmall),
                    onTap: _loading ? null : () => _pick(item),
                  ),
              ],
            ),
          ),
        // 有地址就顯示出來，這是「選到的是不是我想的那一家」唯一看得出來的地方。
        if (selected != null &&
            selected.name == _query.text.trim() &&
            selected.address != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(selected.address!, style: text.bodySmall),
          ),
      ],
    );
  }
}
