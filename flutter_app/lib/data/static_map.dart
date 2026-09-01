import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../domain/place_totals.dart';

/// 旅費報告的靜態地圖。`src/services/staticMap.ts` 的 Dart 版。
///
/// **刻意不用互動地圖。** 報告是公開連結，在那個頁面載地圖 SDK 的話：
/// 每次有人開啟都算一次 API 呼叫（連結被轉傳＝帳單失控，而且你擋不住），
/// 而且金鑰會出現在一個設計上就是要到處轉傳的頁面裡。
///
/// 改成產生報告時呼叫 Static Maps **一次**、把 PNG 存進 Storage，
/// 之後永遠是 0 次呼叫，公開頁面也完全不帶金鑰。代價是不能縮放拖曳。
///
/// 注意這裡用的是 **Maps Static API**，跟 `PlaceMap` 用的地圖 SDK 在
/// Google Cloud 是兩個獨立的 API。同一把金鑰要兩個都開，只開一個的話
/// 這裡會拿到 403。

const String _endpoint = 'https://maps.googleapis.com/maps/api/staticmap';
const String _language = 'zh-TW';

/// 搭配 scale=2，實際輸出是 1280x800，在高解析度螢幕上才不會糊。
const String _size = '640x400';

/// Google 的錯誤訊息是一整段文字，截短才塞得進一行提示。
const int _maxReasonLength = 200;

/// 這個數字跟 storage.rules 裡 map.png 的上限必須一致。
/// 不一致的話上傳會被規則擋掉，而錯誤碼是看不懂的 unauthorized。
const int maxMapBytes = 1 * 1024 * 1024;

/// 跟 `PlaceMap` 讀的是同一把金鑰、同一個 `--dart-define`。
const String _apiKey = String.fromEnvironment('MAPS_API_KEY');

bool get staticMapEnabled => _apiKey.isNotEmpty;

/// 地圖是加分不是必要，所以失敗一律不擋報告 —— 但要講得出原因。
///
/// 網頁版當初每種失敗都回傳 null，結果「沒設金鑰」「地點沒座標」
/// 「API 沒開通」「配額用完」在畫面上長得一模一樣，等於沒有辦法查。
class StaticMapResult {
  final Uint8List? bytes;

  /// bytes 是 null 時說明為什麼，給產生報告的人看。成功時是 null。
  final String? reason;

  const StaticMapResult({this.bytes, this.reason});
}

String _shorten(String text) {
  final clean = text.trim().replaceAll(RegExp(r'\s+'), ' ');
  return clean.length > _maxReasonLength
      ? '${clean.substring(0, _maxReasonLength)}...'
      : clean;
}

Future<StaticMapResult> fetchStaticMap(
  List<PlaceTotal> places, {
  http.Client? client,
}) async {
  if (_apiKey.isEmpty) {
    return const StaticMapResult(
      reason: '這個版本沒有帶 MAPS_API_KEY，所以產不出地圖。報告的其他內容不受影響。',
    );
  }

  final located = mappablePlaces(places);
  if (located.isEmpty) {
    return const StaticMapResult(
      reason: '支出裡沒有帶座標的地點 —— 用純文字打的地點沒有經緯度，畫不到地圖上。',
    );
  }

  // 不指定 center 與 zoom，Google 會自動框住所有標記。
  final markers = located.map((p) => '${p.lat},${p.lng}').join('|');
  final uri = Uri.parse(_endpoint).replace(queryParameters: {
    'size': _size,
    'scale': '2',
    'maptype': 'roadmap',
    'language': _language,
    'key': _apiKey,
    'markers': 'color:0xe8590c|$markers',
  });

  final httpClient = client ?? http.Client();
  try {
    final response = await httpClient.get(uri);
    if (response.statusCode != 200) {
      // Static Maps 的錯誤內容是 text/plain，而且寫得很清楚（沒開通這個
      // API、金鑰限制不符、超出配額）。原文照抄比自己編一句有用得多。
      return StaticMapResult(
        reason: _shorten(
          '地圖服務回應 ${response.statusCode}'
          '${response.body.isEmpty ? '' : '：${response.body}'}'
          '（這個功能用的是 Maps Static API，跟地圖 SDK 要分開開通）',
        ),
      );
    }
    return StaticMapResult(bytes: response.bodyBytes);
  } catch (err) {
    return StaticMapResult(reason: _shorten('連不上地圖服務：$err'));
  } finally {
    // 自己開的才自己關 —— 呼叫端傳進來的 client 可能還要繼續用。
    if (client == null) httpClient.close();
  }
}
