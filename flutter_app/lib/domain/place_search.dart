import 'dart:math';

import 'models.dart';

/// Places API (New) 的請求與回應形狀。`src/services/placeService.ts` 裡
/// 不碰網路的那半。
///
/// 拆出來是為了測得到：回應的巢狀結構有好幾層可以是空的，
/// 而那些正是實際會出錯的地方 —— 網路那半（`lib/data/place_service.dart`）
/// 只剩下 fetch 與換錯誤訊息。

class PlaceSuggestion {
  final String placeId;
  final String primary;
  final String secondary;

  const PlaceSuggestion({
    required this.placeId,
    required this.primary,
    required this.secondary,
  });
}

/// Autocomplete 與後續的 details 用同一個 session token 才算一次計費，
/// 所以每次「開始打字到選定地點」共用一個 token，選完就換一個新的。
///
/// 格式是 UUID v4。Google 只要求它是一個夠獨特的字串，但照規格產生
/// 沒有壞處，而且看 log 時一眼認得出來這是什麼。
String newSessionToken() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  // 標記版本（4）與 variant（10xx），其餘都是亂數。
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  String hex(int start, int end) => bytes
      .sublist(start, end)
      .map((b) => b.toRadixString(16).padLeft(2, '0'))
      .join();

  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}

/// Autocomplete 的請求內容。
///
/// [bias] 是 `locationBias(...)` 的結果，null 就整個欄位不放進去 ——
/// 跟網頁版靠 `JSON.stringify` 略過 undefined 是同一個效果，
/// 沒有偏好時送出去的請求跟以前完全一樣。
Map<String, dynamic> autocompleteBody({
  required String input,
  required String sessionToken,
  Map<String, dynamic>? bias,
  String language = 'zh-TW',
}) {
  return {
    'input': input.trim(),
    'sessionToken': sessionToken,
    'languageCode': language,
    if (bias != null) 'locationBias': bias,
  };
}

/// 從 autocomplete 的回應挑出建議清單。
///
/// 會被丟掉的：查詢建議（`queryPrediction`，那是「再搜尋一次」不是一個地點）、
/// 以及沒有 placeId 或沒有名字的項目 —— 那種選了也拿不到詳細資料。
List<PlaceSuggestion> parseSuggestions(Map<String, dynamic> payload) {
  final raw = payload['suggestions'];
  if (raw is! List) return const [];

  final out = <PlaceSuggestion>[];
  for (final item in raw) {
    if (item is! Map) continue;
    final prediction = item['placePrediction'];
    if (prediction is! Map) continue;

    final structured = prediction['structuredFormat'];
    final placeId = _string(prediction['placeId']);
    // 沒有 structuredFormat 時退回整串文字 —— 有名字總比沒有好。
    final primary = _text(structured is Map ? structured['mainText'] : null) ??
        _text(prediction['text']) ??
        '';
    final secondary =
        _text(structured is Map ? structured['secondaryText'] : null) ?? '';

    if (placeId == null || primary.isEmpty) continue;
    out.add(PlaceSuggestion(
      placeId: placeId,
      primary: primary,
      secondary: secondary,
    ));
  }
  return out;
}

/// 從 details 的回應組出一個地點。
///
/// [fallbackId] 是當初查詢用的 placeId：回應裡照理會帶 `id`，
/// 但那是我們唯一能回頭再查一次的鑰匙，寧可補上也不要留 null。
ExpensePlace parsePlaceDetails(
  Map<String, dynamic> payload,
  String fallbackId,
) {
  final location = payload['location'];
  return ExpensePlace(
    name: _text(payload['displayName']) ?? '',
    address: _string(payload['formattedAddress']),
    lat: location is Map ? _number(location['latitude']) : null,
    lng: location is Map ? _number(location['longitude']) : null,
    placeId: _string(payload['id']) ?? fallbackId,
  );
}

/// 從錯誤回應裡挖出可以給人看的訊息。
///
/// Google 的錯誤（金鑰沒開 Places API、被 referrer 限制擋掉）都在
/// `error.message` 裡，而且寫得比「HTTP 403」有用得多，值得留著。
String placeErrorMessage(Map<String, dynamic>? payload, int status) {
  final error = payload?['error'];
  final message = error is Map ? _string(error['message']) : null;
  return message ?? '地點服務回應 $status';
}

/// 金鑰設定不對時給使用者看的話。
///
/// 這種錯誤（403、referrer 被擋、API 沒啟用）**是設定問題，不是使用者做錯什麼**，
/// 而且他當下什麼也做不了。所以第一句話要講的是「你還是可以繼續」——
/// 地點欄位打字就能存，只是少了座標。
///
/// 原文留在第二行：這只在設定壞掉時才會出現，而那時看得到 Google 的原話
/// 才修得動。把它藏起來只會讓人對著「暫時無法使用」猜半天。
String placeErrorHint(String message, {int? status}) {
  final blocked = status == 403 ||
      status == 401 ||
      message.contains('referer') ||
      message.contains('API key') ||
      message.contains('API_KEY') ||
      message.contains('not enabled') ||
      message.contains('PERMISSION_DENIED');
  if (!blocked) return message;
  return '地點搜尋現在用不了，直接打地點名字一樣存得起來（只是不會有座標）。\n$message';
}

String? _string(dynamic value) =>
    value is String && value.isNotEmpty ? value : null;

/// Places 的文字欄位都是 `{text: "...", languageCode: "..."}` 這種形狀。
String? _text(dynamic value) =>
    value is Map ? _string(value['text']) : _string(value);

double? _number(dynamic value) => value is num ? value.toDouble() : null;
