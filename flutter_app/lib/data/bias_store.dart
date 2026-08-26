import 'package:shared_preferences/shared_preferences.dart';

import '../domain/bias_memory.dart';
import '../domain/models.dart';
import '../domain/place_bias.dart';

/// 把地點偏好存進 SharedPreferences。規則都在 `domain/bias_memory.dart`，
/// 這裡只負責搬字串。
///
/// 每個方法都吞掉例外：這是「上次在哪」，不是使用者的資料。
/// 讀不到就沒有偏好，寫不進去就下次沒有偏好 —— 都不該讓表單失敗。
class BiasStore {
  static const _key = 'splitflow:place-bias';

  Future<LatLng?> recall(String taskId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return recallBias(prefs.getString(_key), taskId);
    } catch (_) {
      return null;
    }
  }

  Future<void> remember(String taskId, ExpensePlace place) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final next = rememberBias(prefs.getString(_key), taskId, place);
      // null 代表這個地點沒有座標，保留原本存好的那份。
      if (next != null) await prefs.setString(_key, next);
    } catch (_) {
      // 存不進去就算了。
    }
  }
}
