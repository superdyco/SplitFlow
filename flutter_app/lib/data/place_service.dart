import 'dart:convert';

import 'package:http/http.dart' as http;

import '../domain/models.dart';
import '../domain/place_bias.dart';
import '../domain/place_search.dart';
import 'app_identity.dart';

/// Places API (New) 的 REST 端點。`src/services/placeService.ts` 的 Dart 版。
///
/// 跟網頁版一樣不載整包 Maps SDK —— 地點搜尋只需要兩個 request。
///
/// **金鑰**：用 `--dart-define=PLACES_API_KEY=...` 傳進來，
/// 沒設就整個功能停用、地點欄位退回純文字輸入（`placesEnabled` 為 false）。
/// 網頁版沒設定金鑰時也是這樣退化的。
///
/// ⚠️ **網頁版那把金鑰不能直接拿來用。** 它設的是 HTTP referrer 限制，
/// 而 Android 的請求沒有 referrer。原生版要一把限制成「Android 應用程式」
/// 的金鑰（套件名 + 簽章 SHA-1）。
///
/// 而且光有那把金鑰還不夠：**REST 請求要自己把身分附上去**。
/// 原生 SDK（例如地圖）會自動送套件名與簽章，走 http 套件的請求不會 ——
/// Google 那邊看到的是 `<empty>`，回的是
/// `Requests from this Android client application <empty> are blocked`。
/// 所以每個請求都要帶 `X-Android-Package` 與 `X-Android-Cert`
/// （見 `app_identity.dart`）。
class PlaceService {
  static const _autocompleteUrl =
      'https://places.googleapis.com/v1/places:autocomplete';
  static const _detailsUrl = 'https://places.googleapis.com/v1/places';
  static const _language = 'zh-TW';

  /// 編譯期常數：沒傳 `--dart-define` 就是空字串。
  static const _apiKey = String.fromEnvironment('PLACES_API_KEY');

  final http.Client _client;

  PlaceService({http.Client? client}) : _client = client ?? http.Client();

  /// 沒設金鑰的話地點欄位會退回純文字輸入，功能不會壞掉。
  static bool get placesEnabled => _apiKey.isNotEmpty;

  /// [bias] 讓「星巴克」這種到處都有的名字優先回傳附近的分店。
  Future<List<PlaceSuggestion>> autocomplete(
    String input,
    String sessionToken, {
    LatLng? bias,
  }) async {
    final trimmed = input.trim();
    if (_apiKey.isEmpty || trimmed.isEmpty) return const [];

    final response = await _client.post(
      Uri.parse(_autocompleteUrl),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': _apiKey,
        ...?await AppIdentity.headers(),
      },
      body: jsonEncode(autocompleteBody(
        input: trimmed,
        sessionToken: sessionToken,
        bias: locationBias(bias),
        language: _language,
      )),
    );

    final payload = _decode(response);
    if (response.statusCode != 200) {
      throw PlaceException(placeErrorHint(
        placeErrorMessage(payload, response.statusCode),
        status: response.statusCode,
      ));
    }
    return parseSuggestions(payload ?? const {});
  }

  Future<ExpensePlace> details(String placeId, String sessionToken) async {
    if (_apiKey.isEmpty) throw const PlaceException('沒有設定地點服務金鑰');

    final uri = Uri.parse('$_detailsUrl/${Uri.encodeComponent(placeId)}')
        .replace(queryParameters: {
      'sessionToken': sessionToken,
      'languageCode': _language,
    });

    final response = await _client.get(uri, headers: {
      'X-Goog-Api-Key': _apiKey,
      ...?await AppIdentity.headers(),
      // 只要這幾個欄位。FieldMask 直接決定計費等級，多要幾個欄位就跳到
      // 更貴的那一階，而地圖與報告需要的就只有座標跟地址。
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
    });

    final payload = _decode(response);
    if (response.statusCode != 200) {
      throw PlaceException(placeErrorHint(
        placeErrorMessage(payload, response.statusCode),
        status: response.statusCode,
      ));
    }
    return parsePlaceDetails(payload ?? const {}, placeId);
  }

  /// 回應不是 JSON 也不要炸掉 —— 那時 status code 本身就是訊息了。
  Map<String, dynamic>? _decode(http.Response response) {
    try {
      final value = jsonDecode(utf8.decode(response.bodyBytes));
      return value is Map<String, dynamic> ? value : null;
    } catch (_) {
      return null;
    }
  }
}

/// 地點服務自己的錯誤，讓 UI 分得出「搜尋失敗」與別的例外。
class PlaceException implements Exception {
  final String message;
  const PlaceException(this.message);

  @override
  String toString() => message;
}
