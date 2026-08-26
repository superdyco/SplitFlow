import 'dart:convert';

import 'models.dart';
import 'place_bias.dart';

/// 「每個任務最後用過的座標」這份記憶的讀寫規則。
/// `src/services/placeService.ts` 裡 `recallPlaceBias` / `rememberPlaceBias`
/// 的 Dart 版，但只負責字串進、字串出 —— 真的存到哪裡是呼叫端的事。
///
/// 這樣分是為了測得到淘汰與壞資料這兩件事，它們才是會出問題的地方；
/// 至於是 localStorage 還是 SharedPreferences，兩邊都只是一個鍵值對。
///
/// 依任務分開記，因為不同旅程在不同城市，共用一個座標會偏到錯的地方。

/// 只留最近這幾個任務，免得用久了無限長大。
const int biasLimit = 20;

/// 從存起來的字串讀出某個任務的偏好座標。
///
/// 讀不出來就是沒有偏好 —— 無痕模式、換裝置、或存進去的內容壞掉，
/// 結果都一樣：退回全球搜尋，不是錯誤。
LatLng? recallBias(String? stored, String taskId) {
  final map = _decode(stored);
  final entry = map[taskId];
  if (entry is! Map) return null;

  final lat = entry['lat'];
  final lng = entry['lng'];
  if (lat is! num || lng is! num) return null;
  return LatLng(lat.toDouble(), lng.toDouble());
}

/// 把新的座標寫回去，回傳要存起來的字串。
///
/// 地點沒有座標時回傳 null，代表**不要動**已經存好的那份 ——
/// 只打名字沒選建議的地點不該把上一次的偏好洗掉。
String? rememberBias(String? stored, String taskId, ExpensePlace place) {
  final lat = place.lat;
  final lng = place.lng;
  if (lat == null || lng == null) return null;

  final map = _decode(stored);
  // 先刪再放，讓這個任務排到最後：Dart 的 Map 保證插入順序，
  // 所以「最前面」就是最久沒用到的那些。
  map.remove(taskId);

  final entries = map.entries.toList();
  final keep = entries.length > biasLimit - 1
      ? entries.sublist(entries.length - (biasLimit - 1))
      : entries;

  return jsonEncode({
    for (final entry in keep) entry.key: entry.value,
    taskId: {'lat': lat, 'lng': lng},
  });
}

Map<String, dynamic> _decode(String? stored) {
  if (stored == null || stored.isEmpty) return {};
  try {
    final value = jsonDecode(stored);
    return value is Map<String, dynamic> ? value : {};
  } catch (_) {
    // 存進去的內容壞掉，當作沒有。丟掉一份「上次在哪」不值得讓表單開不起來。
    return {};
  }
}
